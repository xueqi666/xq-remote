#!/usr/bin/env node
// SSH 客户端负责远程目录准备、SFTP 上传和版本切换。
const { Client } = require("ssh2");
// 通过参数数组调用 tar，避免本地路径中的空格影响压缩。
const { execFileSync } = require("child_process");
// 在连接服务器前校验删除范围并生成远程部署命令。
const { buildPrepareCommands, buildRemoteCommands } = require("./remote-commands");
// 加载环境配置并检查本地构建内容。
const { loadDeploymentConfig } = require("./deployment-config");

// **Step 1: 压缩 dist 文件夹**
function compressDist(config) {
  execFileSync("tar", ["-czf", config.tarFilePath, "-C", config.localDir, "."]);
  return config.tarFilePath;
}

// **Step 2: 上传文件**
function uploadFile(localFile, remoteFile, conn, callback) {
  conn.sftp((err, sftp) => {
    if (err) {
      console.error("[xq-remote] SFTP 初始化失败:", err.message);
      process.exitCode = 1;
      conn.end();
      return;
    }

    sftp.fastPut(localFile, remoteFile, (err) => {
      if (err) {
        console.error("[xq-remote] 上传失败:", err.message);
        process.exitCode = 1;
        conn.end();
        return;
      }
      callback();
    });
  });
}

// 顺序执行远程步骤，只有退出码为零才允许进入下一步。
function executeRemoteCommands(conn, commands, onSuccess) {
  conn.exec(commands, (err, stream) => {
    if (err) {
      console.error("[xq-remote] 无法执行远程命令:", err.message);
      process.exitCode = 1;
      conn.end();
      return;
    }

    stream
      .on("close", (code) => {
        if (code !== 0) {
          console.error(`[xq-remote] 远程步骤失败，退出码: ${code}`);
          process.exitCode = 1;
          conn.end();
          return;
        }
        onSuccess();
      })
      .on("data", (data) => {
        console.log("远程输出:", data.toString());
      })
      .stderr.on("data", (data) => {
        console.error("远程错误:", data.toString());
      });
  });
}

// **主流程**
function deploy() {
  // 环境选择、配置读取和构建校验在创建 SSH 连接之前完成。
  const config = loadDeploymentConfig();
  // 上传包位于部署父目录，清理 dist 时不会将它一起删除。
  const remoteTarFile = `${config.remoteDir}/${config.tarFileName}`;
  // 上传前准备远程父目录并检查写入权限。
  const prepareCommands = buildPrepareCommands(config, remoteTarFile);
  // 同级临时解压、校验、切换和失败恢复命令，提前完成路径校验。
  const commands = buildRemoteCommands(config, remoteTarFile);
  // 压缩成功后用于 SFTP 上传的本地包路径。
  const tarFilePath = compressDist(config);
  // 本次部署独立使用的 SSH 连接。
  const conn = new Client();

  conn.on("ready", () => {
    executeRemoteCommands(conn, prepareCommands, () => {
      uploadFile(tarFilePath, remoteTarFile, conn, () => {
        executeRemoteCommands(conn, commands, () => conn.end());
      });
    });
  });

  conn.on("error", (err) => {
    process.exitCode = 1;
    console.error(
      "[xq-remote] SSH 连接失败:",
      err.message,
    );
    conn.end();
  });

  conn.connect({
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
  });
}

// 配置、校验和压缩错误统一返回非零状态，不继续部署。
try {
  deploy();
} catch (error) {
  console.error("[xq-remote] 部署准备失败:", error.message);
  process.exitCode = 1;
}
