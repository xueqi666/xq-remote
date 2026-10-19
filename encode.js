// 兼容原有 node encode.js "文本" 调用，与 encrypt.js 使用同一套 Base64 编码。
const { runBase64Cli } = require("./base64-cli");
runBase64Cli("encode");
