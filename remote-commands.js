// 使用 POSIX 路径规则处理 Linux 服务器上的部署目录。
const path = require("path").posix;
// 本地和远程复用同一套必要文件路径规则。
const { normalizeRequiredFiles } = require("./deployment-config");

// 将路径转换为单个 shell 参数，保留空格、单引号和特殊字符。
function quoteShell(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

// 规范化远程绝对路径，避免空配置、控制字符或相对路径参与删除操作。
function normalizeRemotePath(value, name) {
  if (
    typeof value !== "string" || !value.trim() ||
    /[\x00-\x1f\x7f]/.test(value) || !path.isAbsolute(value)
  ) {
    throw new Error(`${name} 必须是有效的远程绝对路径`);
  }
  return path.resolve(value);
}

// 判断目标是否严格位于父目录内，排除父目录自身和目录越界。
function isInside(parent, target) {
  // relative 是按路径层级计算的相对路径，避免同名前缀导致误判。
  const relative = path.relative(parent, target);
  return relative !== "" && relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative);
}

// 统一校验上传和版本切换涉及的远程路径。
function getDeploymentPaths(config, remoteTarFile) {
  // 部署父目录用于限制允许删除的目录范围。
  const remoteDir = normalizeRemotePath(config.remoteDir, "remoteDir");
  // 解压目录必须是部署父目录的严格子目录。
  const extractedDir = normalizeRemotePath(config.remoteExtractedDir, "remoteExtractedDir");
  // 上传包必须位于父目录内、解压目录外，避免清理旧目录时删除新包。
  const archivePath = normalizeRemotePath(remoteTarFile, "remoteTarFileName");
  if (!isInside(remoteDir, extractedDir)) {
    throw new Error("remoteExtractedDir 必须位于 remoteDir 内，且不能等于 remoteDir");
  }
  if (
    !isInside(remoteDir, archivePath) || archivePath === extractedDir ||
    isInside(extractedDir, archivePath) || isInside(archivePath, extractedDir)
  ) {
    throw new Error("上传包必须位于 remoteDir 内，且不能与解压目录重叠");
  }
  return { remoteDir, extractedDir, archivePath };
}

// 上传前创建父目录，并检查目录可写、可进入；失败时不启动 SFTP。
function buildPrepareCommands(config, remoteTarFile) {
  // 路径通过与正式部署完全相同的边界检查。
  const { remoteDir, archivePath } = getDeploymentPaths(config, remoteTarFile);
  return `
    set -e
    mkdir -p -- ${quoteShell(remoteDir)} ${quoteShell(path.dirname(archivePath))}
    test -w ${quoteShell(path.dirname(archivePath))} && test -x ${quoteShell(path.dirname(archivePath))} || {
      echo "上传目录不可写或无法进入，请检查目录权限" >&2
      exit 1
    }
    echo "上传目录准备完成"
  `;
}

// 在同级临时目录解压并验证，再替换线上目录；切换失败时恢复旧版本。
function buildRemoteCommands(config, remoteTarFile) {
  // 远程目录全部规范化，限制操作范围。
  const { extractedDir, archivePath } = getDeploymentPaths(config, remoteTarFile);
  // 必要文件在实际解压结果中再次检查，避免空包或不完整上传替换线上版本。
  const requiredChecks = normalizeRequiredFiles(config.requiredFiles).map((file) => `
    test -f "$work/new"/${quoteShell(file)} && test -s "$work/new"/${quoteShell(file)} || {
      printf '%s\\n' ${quoteShell(`解压结果缺少非空的必要文件: ${file}`)} >&2
      exit 1
    }`).join("\n");

  // 预先引用路径，保证远程 shell 将每个路径作为一个完整参数处理。
  const target = quoteShell(extractedDir);
  // 压缩包路径与目标目录独立引用，支持带空格或单引号的文件名。
  const archive = quoteShell(archivePath);
  return `
    set -e
    # work 为本次部署创建的同级临时目录；installed 记录是否完成版本切换。
    work=''
    installed=0
    target=${target}

    # 退出时清理临时文件；旧版本已移走但新版本未安装时，优先恢复旧目录。
    finish() {
      # 保存原始失败码，恢复或清理失败同样返回非零状态。
      status=$?
      trap - 0 1 2 15
      set +e
      if [ "$installed" -eq 0 ] && [ -n "$work" ] && [ -d "$work/previous" ]; then
        if [ ! -e "$target" ] && [ ! -L "$target" ]; then
          if ! mv -T -- "$work/previous" "$target"; then
            printf '恢复失败，旧版本保留在: %s\\n' "$work/previous" >&2
            exit 1
          fi
          echo "已恢复旧版本" >&2
        else
          printf '目标目录已存在，旧版本保留在: %s\\n' "$work/previous" >&2
          exit 1
        fi
      fi
      if [ -n "$work" ] && ! rm -rf -- "$work"; then
        printf '临时目录清理失败: %s\\n' "$work" >&2
        exit 1
      fi
      exit "$status"
    }
    trap finish 0
    trap 'exit 129' 1
    trap 'exit 130' 2
    trap 'exit 143' 15

    echo "校验上传的压缩包..."
    tar -tzf ${archive} > /dev/null
    # 拒绝符号链接目标，避免替换掉外部发布系统维护的链接。
    if [ -L "$target" ] || { [ -e "$target" ] && [ ! -d "$target" ]; }; then
      echo "部署目标必须是普通目录，不能是文件或符号链接" >&2
      exit 1
    fi
    mkdir -p -- ${quoteShell(path.dirname(extractedDir))}
    work=$(mktemp -d ${quoteShell(path.join(path.dirname(extractedDir), ".xq-remote-XXXXXX"))})
    mkdir -- "$work/new"
    echo "解压新版本到临时目录..."
    tar -xzf ${archive} -C "$work/new"
    # 符号链接无法保证构建内容一致性；至少需要一个非空普通文件。
    # 分开赋值以传播 find 的失败状态，防止读取错误被 test 掩盖。
    links=$(find "$work/new" -type l -print -quit)
    content=$(find "$work/new" -type f -size +0c -print -quit)
    if [ -n "$links" ] || [ -z "$content" ]; then
      echo "解压结果为空或包含符号链接，已停止替换旧版本" >&2
      exit 1
    fi
    ${requiredChecks}
    echo "修改目录权限为 777..."
    chmod -R 777 -- "$work/new"

    echo "切换部署目录..."
    if [ -d "$target" ]; then mv -T -- "$target" "$work/previous"; fi
    mv -T -- "$work/new" "$target"
    installed=1

    echo "清理旧版本..."
    rm -rf -- "$work"
    work=''

    echo "删除上传的 tar 文件..."
    rm -f -- ${archive}
    echo "部署文件替换完成"
  `;
}

module.exports = { buildPrepareCommands, buildRemoteCommands };
