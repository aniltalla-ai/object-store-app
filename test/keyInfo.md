
## Testing OAuth Tokens

When running the application locally (`npm run test:server` or local mock auth), use pre-generated test Bearer tokens to simulate different customer tenant users and object store instances (`object_store_instance`).

### 🔑 Pre-generated Test Tokens

| Instance Target | Test User | Base64 Bearer Token Value |
| :--- | :--- | :--- |
| **`INST_01`** | `user1@customer.com` | `eyJ1c2VyIjoidXNlcjFAY3VzdG9tZXIuY29tIiwib2JqZWN0X3N0b3JlX2luc3RhbmNlIjoiSU5TVF8wMSJ9` |
| **`INST_02`** | `user2@customer.com` | `eyJ1c2VyIjoidXNlcjJAY3VzdG9tZXIuY29tIiwib2JqZWN0X3N0b3JlX2luc3RhbmNlIjoiSU5TVF8wMiJ9` |
| **`INST_03`** | `user3@customer.com` | `eyJ1c2VyIjoidXNlcjNAY3VzdG9tZXIuY29tIiwib2JqZWN0X3N0b3JlX2luc3RhbmNlIjoiSU5TVF8MDMifQ==` |

---

### 📋 Authorization Header Examples

#### For `INST_01`:
```http
Authorization: Bearer eyJ1c2VyIjoidXNlcjFAY3VzdG9tZXIuY29tIiwib2JqZWN0X3N0b3JlX2luc3RhbmNlIjoiSU5TVF8wMSJ9
```

#### For `INST_02`:
```http
Authorization: Bearer eyJ1c2VyIjoidXNlcjJAY3VzdG9tZXIuY29tIiwib2JqZWN0X3N0b3JlX2luc3RhbmNlIjoiSU5TVF8wMiJ9
```

#### Standard JWT 3-part Format (`INST_01`):
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoidXNlcjFAY3VzdG9tZXIuY29tIiwib2JqZWN0X3N0b3JlX2luc3RhbmNlIjoiSU5TVF8wMSJ9.signature
```

---

### 🛠️ How to Generate Custom Test Tokens

To generate a test token for a custom user or instance name using Node.js:

```javascript
const user = "admin@mycompany.com";
const instance = "CUSTOM_INST_99";

const payload = JSON.stringify({ user, object_store_instance: instance });
const token = Buffer.from(payload).toString('base64');

console.log(`Authorization: Bearer ${token}`);
```
