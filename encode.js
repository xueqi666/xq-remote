// encode.js
// 运行方式: node encode.js "你要加密的密码"

const args = process.argv.slice(2);
const plainText = args[0];

if (!plainText) {
  console.error("❌ 错误: 请输入需要转换的明文密码！");
  console.log("👉 示例: node encode.js mypassword123");
  process.exit(1);
}

// 核心转换逻辑： utf-8 -> base64
const base64Str = Buffer.from(plainText, "utf-8").toString("base64");

console.log("✅ 转换成功！");
console.log("--------------------------------------------------");
console.log("明文:", plainText);
console.log("Base64:", base64Str);
console.log("--------------------------------------------------");
console.log("你可以将上述 Base64 字符串复制到你的 config json 文件中了。");
