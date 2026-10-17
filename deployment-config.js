// 本地文件检查使用 Node 文件系统接口，不执行部署命令。
const fs = require("fs");
// 本地路径按宿主系统解析，包内相对路径使用 POSIX 格式。
const path = require("path");

// 规范化必要文件清单，禁止绝对路径、目录自身和向上越界。
function normalizeRequiredFiles(value = []) {
  if (!Array.isArray(value)) throw new Error("requiredFiles 必须是相对文件路径数组");
  return value.map((file) => {
    if (typeof file !== "string" || !file.trim() || /[\x00-\x1f\x7f]/.test(file)) {
      throw new Error("requiredFiles 中的文件名不能为空或包含控制字符");
    }
    // Windows 配置中的反斜杠统一转为包内使用的正斜杠。
    const normalized = path.posix.normalize(file.replace(/\\/g, "/"));
    if (path.win32.isAbsolute(file) || path.posix.isAbsolute(normalized) ||
        normalized === "." || normalized === ".." || normalized.startsWith("../") ||
        /^[A-Za-z]:/.test(normalized)) {
      throw new Error(`requiredFiles 必须位于构建目录内: ${file}`);
    }
    return normalized;
  });
}

// 判断子路径是否位于父目录内，兼容 Windows 的盘符和路径分隔符。
function isWithin(parent, target) {
  // 使用路径层级而非字符串前缀识别父子关系。
  const relative = path.relative(parent, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

// 拒绝空构建、项目根目录、越界链接和缺少必要文件的构建产物。
function validateLocalBuild(value, requiredFiles = [], cwd = process.cwd()) {
  if (typeof value !== "string" || !value.trim()) throw new Error("localDir 不能为空，请指定构建目录");
  // realpath 同时确认目录存在，并消除指向项目根目录的链接别名。
  const localDir = fs.realpathSync(path.resolve(cwd, value));
  // 项目根目录及其祖先不允许作为构建目录，避免打包源码和配置。
  const projectDir = fs.realpathSync(cwd);
  if (!fs.statSync(localDir).isDirectory() || isWithin(localDir, projectDir)) {
    throw new Error("localDir 必须是独立的构建目录，不能是项目根目录或其父目录");
  }
  // 遍历所有目录，空目录和零字节文件不能单独构成有效构建。
  const pending = [localDir];
  // 记录是否找到至少一个有内容的普通文件。
  let hasContent = false;
  while (pending.length) {
    // 当前待检查目录；所有子项均来自该目录的实际读取结果。
    const directory = pending.pop();
    // 检查每个文件，拒绝无法保证远程目标一致的符号链接。
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      // 当前构建条目的绝对路径。
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`构建产物不能包含符号链接: ${entryPath}`);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && fs.statSync(entryPath).size > 0) hasContent = true;
      else if (!entry.isFile()) throw new Error(`构建产物包含不支持的文件类型: ${entryPath}`);
    }
  }
  if (!hasContent) throw new Error("构建目录为空或仅包含空文件，请先完成构建");
  // 必要文件必须存在、有内容，并且是普通文件。
  for (const file of normalizeRequiredFiles(requiredFiles)) {
    // 文件清单已限制为构建目录内的相对路径。
    const filename = path.join(localDir, file);
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile() || fs.statSync(filename).size === 0) {
      throw new Error(`构建产物缺少非空的必要文件: ${file}`);
    }
  }
  return localDir;
}

// 在加载 node-config 前统一环境优先级，并在连接服务器前完成配置及产物检查。
function loadDeploymentConfig() {
  // 命令行优先于 NODE_CONFIG_ENV 和 NODE_ENV；未指定时保留 node-config 默认合并规则。
  const environment = process.argv[2] || process.env.NODE_CONFIG_ENV || process.env.NODE_ENV;
  if (environment && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(environment)) {
    throw new Error("环境名只能包含字母、数字、点、下划线和连字符，且必须以字母或数字开头");
  }
  if (environment) {
    process.env.NODE_ENV = environment;
    process.env.NODE_CONFIG_ENV = environment;
  }
  // 延迟加载，确保 CLI 指定的环境不会被已有 NODE_CONFIG_ENV 覆盖。
  const configEnv = require("config");
  // 读取实际加载来源，禁止拼错环境时仅使用 default.json 继续部署。
  const sources = configEnv.util.getConfigSources();
  // 对显式环境精确匹配文件名，避免 prod 错误匹配 production。
  const expected = environment || "default";
  if (!sources.some((source) => path.extname(source.name) && path.parse(source.name).name === expected)) {
    throw new Error(`未加载到环境 ${expected} 的专属配置文件，已停止部署；请检查配置目录和环境名`);
  }
  console.log(`[xq-remote] 部署环境: ${expected}`);
  console.log(`[xq-remote] 实际配置来源: ${sources.map((source) => source.name).join(", ")}`);
  // 必要文件检查可选，通用文件部署默认只检查构建目录含有实际内容。
  const requiredFiles = normalizeRequiredFiles(configEnv.has("requiredFiles") ? configEnv.get("requiredFiles") : []);
  // 校验先于打包和 SSH，失败时不会触及服务器。
  const localDir = validateLocalBuild(configEnv.get("localDir"), requiredFiles);
  // 保持现有 Base64 密码配置的兼容性。
  const password = configEnv.get("password");
  // 远程目录必须继续通过命令生成器的删除范围校验。
  const remoteDir = configEnv.get("remoteDir");
  // 防止 null 等非字符串值被拼接成意外的部署目录名。
  const extractedName = configEnv.get("remoteExtractedDir");
  if (typeof extractedName !== "string" || !extractedName.trim() || path.posix.isAbsolute(extractedName)) {
    throw new Error("remoteExtractedDir 必须是 remoteDir 下的非空相对子目录名");
  }
  // 未配置包名时使用默认值，避免 config.get 先抛错导致默认值失效。
  const tarFileName = configEnv.has("remoteTarFileName") ? configEnv.get("remoteTarFileName") : "dist.tar.gz";
  if (typeof tarFileName !== "string" || !tarFileName.trim()) throw new Error("remoteTarFileName 必须是非空文件名");
  // 压缩包不能生成在构建目录内，防止将旧包或正在生成的包收入新包。
  const tarFilePath = path.resolve(process.cwd(), tarFileName);
  if (isWithin(localDir, tarFilePath)) throw new Error("压缩包不能放在 localDir 构建目录内");
  return {
    host: configEnv.get("host"), // SSH 主机地址。
    port: configEnv.get("port"), // SSH 端口。
    username: configEnv.get("username"), // SSH 登录用户。
    password: password ? Buffer.from(password, "base64").toString("utf8") : undefined, // 解码后的登录密码。
    localDir, // 已检查的本地构建目录。
    requiredFiles, // 本地和远程均需检查的文件清单。
    remoteDir, // 远程部署父目录。
    remoteExtractedDir: `${remoteDir}/${extractedName}`, // 线上版本目录。
    tarFileName, // SFTP 上传包的相对文件名。
    tarFilePath, // 本地压缩包绝对路径。
  };
}

module.exports = { normalizeRequiredFiles, validateLocalBuild, loadDeploymentConfig };
