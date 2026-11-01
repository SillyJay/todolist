# vendor/ 第三方组件

## wcdb_key_tool_windows.py

- 来源：https://github.com/TANGandXUE/wcdb-key-tool
- 许可证：MIT（见 `LICENSE-wcdb-key-tool.txt`）
- 用途：微信 4.1+ 的数据库密钥提取。Windows 走**只读运行时扫描**
  （定位 `com.Tencent.WCDB.Config.Cipher` 对象 → 解出候选 `x'<key><salt>'` →
  用数据库第一页的 HMAC 校验），不注入、不改微信行为。
- 我们对上游文件**未做修改**，仅作为模块导入调用；外层封装见
  `server/adapters/wcdb_runtime.py`。

上游 README 说明：本工具仅用于提取用户自己设备上自己账号的数据库密钥。
