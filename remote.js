#!/usr/bin/env node
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 获取命令行参数作为环境名
const envArg = process.argv[2];
if (envArg) {
  process.env.NODE_ENV = envArg;
}

const configEnv = require('config');
console.log(`[xq-remote] 当前加载环境: ${process.env.NODE_ENV || 'default'}`);

let remoteDir;
try {
  remoteDir = configEnv.get('remoteDir');
} catch (e) {
  console.error(
    `[xq-remote] 错误: 无法在 config/${process.env.NODE_ENV || 'default'}.json 中找到 'remoteDir' 配置。请检查配置文件是否存在且格式正确。`
  );
  process.exit(1);
}
// 配置信息
const config = {
  host: configEnv.get('host'), // 服务器地址
  port: configEnv.get('port'), // SSH 端口
  username: configEnv.get('username'), // 用户名
  password: configEnv.get('password'), // 建议使用 SSH 密钥
  localDir: path.resolve(process.cwd(), configEnv.get('localDir')), // 本地 dist 目录
  remoteDir,
  remoteExtractedDir: `${remoteDir}/${configEnv.get('remoteExtractedDir')}`, // **自定义解压目录**
  tarFileName: configEnv.get('remoteTarFileName') || 'dist.tar.gz' // 远程 tar 包名
};

// **Step 1: 压缩 dist 文件夹**
function compressDist() {
  const tarFilePath = path.resolve(process.cwd(), config.tarFileName);
  try {
    execSync(`tar -czf ${tarFilePath} -C ${config.localDir} .`);
    return tarFilePath;
  } catch (error) {
    process.exit(1);
  }
}

// **Step 2: 上传文件**
function uploadFile(localFile, remoteFile, conn, callback) {
  conn.sftp((err, sftp) => {
    if (err) {
      conn.end();
      return;
    }

    sftp.fastPut(localFile, remoteFile, (err) => {
      if (err) {
        conn.end();
        return;
      }
      callback();
    });
  });
}

// **Step 3: SSH 远程执行解压 & 软链接**
function executeRemoteCommands(conn, remoteTarFile) {
  const commands = `
    set -e
    echo "创建目录: ${config.remoteExtractedDir}"
    mkdir -p ${config.remoteExtractedDir}

    echo "解压 ${remoteTarFile} 到 ${config.remoteExtractedDir}..."
    tar -xzf ${remoteTarFile} -C ${config.remoteExtractedDir}
    echo "解压完成"

    echo "删除旧 tar 文件"
    rm -f ${remoteTarFile}

    echo "切换软链接到 ${config.remoteExtractedDir}"
    ln -sfn ${config.remoteExtractedDir} ${config.remoteDir}/dist

    echo "部署完成"
  `;

  conn.exec(commands, (err, stream) => {
    if (err) {
      conn.end();
      return;
    }

    stream
      .on('close', (code) => {
        conn.end();
      })
      .on('data', (data) => {
        console.log('远程输出:', data.toString());
      })
      .stderr.on('data', (data) => {
        console.error('远程错误:', data.toString());
      });
  });
}

// **主流程**
function deploy() {
  const tarFilePath = compressDist();
  const conn = new Client();

  conn.on('ready', () => {
    const remoteTarFile = `${config.remoteDir}/${config.tarFileName}`;

    uploadFile(tarFilePath, remoteTarFile, conn, () => {
      executeRemoteCommands(conn, remoteTarFile);
    });
  });

  conn.on('error', (err) => {
    console.error(`[xq-remote] SSH 连接失败 (${process.env.NODE_ENV || 'default'}):`, err.message);
    console.error(`请检查 config/${process.env.NODE_ENV || 'default'}.json 中的 host, port, username, password 是否正确。`);
  });

  conn.connect({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password
  });
}

// 执行部署
deploy();
