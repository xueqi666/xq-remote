#!/usr/bin/env node
// 沿用 decrypt 命令名，将项目部署密码的 Base64 文本还原为明文。
const { runBase64Cli } = require("./base64-cli");
runBase64Cli("decode");
