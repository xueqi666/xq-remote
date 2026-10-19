#!/usr/bin/env node
// 沿用 encrypt 命令名，实际按项目原有方式将文本转为 Base64。
const { runBase64Cli } = require("./base64-cli");
runBase64Cli("encode");
