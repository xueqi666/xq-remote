# xq-remote

A simple Node.js tool for deploying local files to a remote server via SSH. It validates and uploads your build, extracts the new version into a temporary directory, then replaces the previous deployment with rollback on switch failure. --智慧用能

## Features

- **Automated Compression**: Uses `tar` to compress your local `dist` folder.
- **SFTP Upload**: Securely transfers the archive to your remote server.
- **Build Validation**: Rejects empty builds and checks optional required files before upload and after extraction.
- **Safe Replacement**: Extracts and prepares the new version before switching directories, restores the previous version if installation fails, and removes obsolete files after a successful switch.
- **Environment Checks**: Requires an exact configuration file match for an explicitly selected environment and prints loaded configuration sources.
- **Configurable**: Easy configuration via `config/default.json`.

## Installation

支持 Node.js 14 及以上版本（`engines.node: >=14.0.0`），部署端需能调用 `tar`。运行代码使用 CommonJS 和 Node 14 已支持的 API，无需额外编译。

```bash
npm install xq-remote -D
```

## Setup

1. Create a `config` directory in your project root.
2. Create environment-specific configuration files (e.g., `default.json`, `prod.json`, `test.json`) with the following structure:

```json
{
  "host": "主机",
  "port": "端口",
  "username": "用户名",
  "password": "Base64编码后的密码",
  "localDir": "dist",
  "requiredFiles": ["index.html"],
  "remoteDir": "/var/www/my-app",
  "remoteExtractedDir": "dist",
  "remoteTarFileName": "dist.tar.gz"
}
```

`localDir` 必须是独立的构建目录，不能留空、指向项目根目录或其父目录，且至少包含一个非空普通文件。`requiredFiles` 可选，默认为 `[]`；前端项目建议配置 `["index.html"]`，本地和远程解压后均会验证这些文件存在且非空。构建产物不支持符号链接。

`remoteDir` 必须是远程绝对路径，`remoteExtractedDir` 是其下的子目录（通常为 `dist`）。上传前会自动创建父目录并检查权限。新版本验证完成后才替换旧目录，成功后清理整个旧目录，包括隐藏文件；需要长期保留的文件应放在该目录之外。上传包应放在 `remoteDir` 下、解压目录之外。

部署流程及失败处理见 [部署目录清理说明](https://github.com/xueqi666/xq-remote/blob/main/docs/deployment-cleanup.md)。

## Usage

Run the deployment from your project root. You can specify the environment as a command-line argument (corresponds to the filename in the `config` folder):

```bash
# Uses node-config defaults (requires config/default.json)
xq-remote

# Uses config/prod.json
xq-remote prod

# Uses config/test.json
xq-remote test
```

环境选择优先级为：命令行参数 > `NODE_CONFIG_ENV` > `NODE_ENV`。显式指定环境时，必须实际加载到该名称的配置文件，例如 `prod.json`；缺少文件或名称写错会立即终止，禁止仅回退到默认配置部署。未指定环境时沿用 node-config 的默认合并规则（包括可能存在的 `development`、`local` 配置），并要求加载到 `default` 配置。每次运行都会打印实际配置来源，支持 `NODE_CONFIG_DIR` 指定配置目录。

目录替换包含两次重命名，存在短暂切换间隙，不是零停机发布。解压或权限设置失败时旧版本不变；安装失败会尝试恢复旧版本，恢复失败时保留备份并打印路径。远程需要 Linux 常用的 `tar`、`find`、`mktemp` 和支持 `mv -T` 的工具。

## Base64 编码与解码

源码项目执行：

```bash
npm run encrypt
npm run decrypt
```

命令名称保留为 `encrypt` / `decrypt`，实际使用本项目已有的 Base64 编码、解码，无需口令。兼容 Node 14，无新增依赖。不传参数时交互输入，输入内容正常显示，也可以传入文本参数：

```bash
npm run encrypt -- "hello"
# 输出 aGVsbG8=
npm run decrypt -- "aGVsbG8="
# 输出 hello
```

编码结果可以直接填入部署配置的 `password`。原有 `node encode.js "文本"` 继续可用，统一只输出编码结果。安装 npm 包后可使用 `npx xq-remote-encrypt` / `npx xq-remote-decrypt`。自动化通过 `--stdin` 传入原始文本，无需 JSON。

Base64 是可逆编码，不是加密。详见[编码解码说明](https://github.com/xueqi666/xq-remote/blob/main/docs/encryption.md)。

## License

MIT
