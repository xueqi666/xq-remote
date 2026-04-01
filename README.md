# xq-remote

A simple Node.js tool for deploying local files to a remote server via SSH. It automatically compresses your local directory, uploads it, and manages remote extraction and symbolic links. --智慧用能

## Features

- **Automated Compression**: Uses `tar` to compress your local `dist` folder.
- **SFTP Upload**: Securely transfers the archive to your remote server.
- **Remote Execution**: Automatically extracts files and updates symlinks on the server.
- **Configurable**: Easy configuration via `config/default.json`.

## Installation

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
  "password": "密码",
  "localDir": "本地目录名",
  "remoteDir": "远程目录名",
  "remoteExtractedDir": "远程解压目录名",
  "remoteTarFileName": "远程压缩文件名"
}
```

## Usage

Run the deployment from your project root. You can specify the environment as a command-line argument (corresponds to the filename in the `config` folder):

```bash
# Uses config/default.json
xq-remote

# Uses config/prod.json
xq-remote prod

# Uses config/test.json
xq-remote test
```

## License

MIT
