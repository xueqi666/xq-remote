# Base64 编码与解码

## 使用范围

沿用项目现有的 `Buffer.from(text, 'utf8').toString('base64')` 和反向转换方式，兼容 Node.js 14，无新增依赖。`encrypt.js` / `decrypt.js` 保留命令名称，实际功能为 Base64 编码和解码，无需加密口令。之前新增的 AES、scrypt 和版本化密文逻辑已移除。

编码结果可以直接填入部署配置的 `password`，部署脚本会按现有逻辑解码。工具不会自动修改配置文件。Base64 是可逆编码，不提供密码保密能力；编码后的密码仍应作为敏感信息保存。

## 交互命令

源码项目执行 `npm run encrypt` / `npm run decrypt`，也可直接执行 `node encrypt.js` / `node decrypt.js`。安装发布后的 npm 包可执行 `npx xq-remote-encrypt` / `npx xq-remote-decrypt`。

不传参数时交互输入待编码文本或 Base64 文本，输入内容正常显示，输入为单行，Ctrl+C 可取消。无需口令和确认步骤。也可使用文本参数，包含空格时需要引号：

```bash
node encrypt.js "hello"
# aGVsbG8=
node decrypt.js "aGVsbG8="
# hello
node encode.js "hello"
# aGVsbG8=
```

交互提示、输入回显和错误使用 stderr，stdout 只含最终结果及一个结尾换行，可重定向。`encode.js` 兼容原有参数调用，统一只输出 Base64，不再额外打印原文。使用前可运行 `node encrypt.js --help`。

## 自动化与程序调用

`node encrypt.js --stdin` 和 `node decrypt.js --stdin` 从标准输入读取原始文本，无需 JSON 或口令。编码会保留输入的所有换行和空白；解码会忽略 Base64 文本首尾空白。输入上限 4 MiB。自动化可由调用进程或秘密管理器提供标准输入，不必将秘密放在命令行参数中。

其他 Node 代码可通过 `require('./base64-cli')` 获取 `encodeText(text)`、`decodeText(text)`，返回字符串。读取模块不会执行 CLI 或启动部署。

## 输入检查

编码要求非空文本。解码仅接受规范 Base64 和有效 UTF-8 文本，通过字符集、长度、填充及重编码检查，避免 `Buffer.from` 静默忽略无效字符。脚本用于密码和文本，不用于任意二进制文件。

错误返回非零退出码，错误信息不包含输入原文。Base64 没有认证功能，合法格式的内容被修改后仍可能解码成功，不能作为完整性校验。

## 验证记录

Node.js 14.18.0 下验证中文、emoji、换行与空白往返、部署密码解码兼容性、原有 encode.js 调用、文本参数、标准输入、非法 Base64 和错误退出码。验证仅使用虚构内容，不保留测试文件，不连接部署服务器。
