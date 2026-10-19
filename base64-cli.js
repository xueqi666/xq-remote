// 终端输入使用 Node 14 自带的 readline，不增加依赖。
const readline = require("readline");

// 与部署脚本保持一致，将 UTF-8 文本编码为 Base64。
function encodeText(text) {
  if (typeof text !== "string" || !text.length) throw new Error("请输入需要编码的文本");
  return Buffer.from(text, "utf8").toString("base64");
}

// 将规范 Base64 还原为 UTF-8 文本，拒绝非法输入而不输出原值。
function decodeText(text) {
  // 允许粘贴或管道输入时带有首尾换行。
  const encoded = typeof text === "string" ? text.trim() : "";
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("请输入有效的 Base64 文本");
  }
  // Buffer.from 默认会忽略部分无效输入，因此再检查规范编码和 UTF-8 往返。
  const decoded = Buffer.from(encoded, "base64");
  // 解码仅用于本项目密码和文本，不支持任意二进制文件。
  const result = decoded.toString("utf8");
  if (decoded.toString("base64") !== encoded || Buffer.from(result, "utf8").toString("base64") !== encoded) {
    throw new Error("输入不是有效的 UTF-8 Base64 文本");
  }
  return result;
}

// 正常显示并读取单行文本，无需口令或确认步骤。
function readInteractive(prompt) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    return Promise.reject(new Error("请传入文本参数，或使用 --stdin 从标准输入读取"));
  }
  return new Promise((resolve, reject) => {
    // 提示与输入回显使用 stderr，stdout 保留给转换结果。
    const input = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true, historySize: 0 });
    // 区分正常提交和用户取消，避免关闭事件重复拒绝结果。
    let submitted = false;
    input.on("SIGINT", () => input.close());
    input.on("close", () => {
      if (!submitted) {
        process.stderr.write("\n");
        reject(new Error("输入已取消"));
      }
    });
    input.question(prompt, (answer) => {
      submitted = true;
      input.close();
      resolve(answer);
    });
  });
}

// 从管道读取原始文本，保留编码输入中的换行和空白。
async function readStdin() {
  // 收集输入 Buffer，避免逐块 UTF-8 解码截断多字节字符。
  const chunks = [];
  // 限制为 4 MiB，防止误将大型文件送入密码工具。
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new Error("标准输入不能超过 4 MiB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// 共享命令入口；stdout 只输出转换结果，错误返回非零退出码。
async function runBase64Cli(mode) {
  try {
    // 命令支持一个文本参数、可见交互或 --stdin 原始文本管道。
    const args = process.argv.slice(2);
    if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
      process.stdout.write(`用法: node ${mode === "encode" ? "encrypt" : "decrypt"}.js [文本 | --stdin]\n不传参数时交互输入，输入内容正常显示；--stdin 读取原始文本，无需 JSON 或口令。\nBase64 是可逆编码，不是加密。\n`);
      return;
    }
    if (args.length > 1) throw new Error("只接受一个文本参数；包含空格时请用引号包裹，或使用 --stdin");
    // 输入只在内存处理，不写配置或临时文件。
    const text = args[0] === "--stdin"
      ? await readStdin()
      : args.length ? args[0] : await readInteractive(mode === "encode" ? "待编码文本: " : "Base64 文本: ");
    // 加密/解密命令名称保留，实际调用现有的 Base64 转换方式。
    const result = mode === "encode" ? encodeText(text) : decodeText(text);
    process.stdout.write(result + "\n");
  } catch (error) {
    console.error(`[xq-remote] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { encodeText, decodeText, runBase64Cli };
