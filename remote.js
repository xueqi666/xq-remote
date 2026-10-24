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

// 顺序执行远程步骤，只有退出码为零才进入下一步，并标明失败阶段。
function executeRemoteCommands(conn, commands, onSuccess, stepName = "远程步骤") {
  // 一个 SSH 通道可能先报错再关闭，避免失败后重复完成或误执行下一步。
  let settled = false;

  // 启动、通道或退出码失败均结束本次部署，且不输出命令正文。
  function fail(message) {
    if (settled) return;
    settled = true;
    console.error(`[xq-remote] ${stepName}失败: ${message}`);
    process.exitCode = 1;
    conn.end();
  }

  conn.exec(commands, (err, stream) => {
    if (err) {
      fail(err.message);
      return;
    }

    stream
      .on("error", (error) => fail(error.message))
      .on("close", (code, signal) => {
        if (settled) return;
        if (code !== 0) {
          fail(signal ? `被信号 ${signal} 终止` : `退出码 ${code}`);
          return;
        }
        settled = true;
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

// 逐项等待 SSH 命令通道成功关闭，再执行数组中的下一条命令。
function executeRemoteGoOn(conn, commands, onSuccess, index = 0) {
  if (index >= commands.length) {
    onSuccess();
    return;
  }
  // 只记录序号，不将配置命令中可能携带的敏感参数写入日志。
  const stepName = `部署后命令 ${index + 1}/${commands.length}`;
  console.log(`[xq-remote] 开始执行${stepName}`);
  executeRemoteCommands(conn, `set -e\n${commands[index]}`, () => {
    console.log(`[xq-remote] ${stepName}执行完成`);
    executeRemoteGoOn(conn, commands, onSuccess, index + 1);
  }, stepName);
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
        executeRemoteCommands(conn, commands, () => {
          executeRemoteGoOn(conn, config.remoteGoOn, () => {
            console.log("[xq-remote] 部署完成");
            conn.end();
          });
        }, "部署文件替换");
      });
    }, "上传目录准备");
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
