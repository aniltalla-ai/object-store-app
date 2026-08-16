# Cloud Foundry Object Store Configuration

This document describes how to configure a Cloud Foundry application to access an Object Store using an Authorization Service and client credentials.

## Prerequisites

* Cloud Foundry CLI installed.
* Access to the required Cloud Foundry organization and space.
* Object Store service instance already created.
* Authorization Service offering and plan available.

## Example Configuration

| Component                 | Example           |
| ------------------------- | ----------------- |
| Object Store instance     | `OS_INST_01`      |
| Cloud Foundry application | `CF_Object_store` |
| Authorization Service     | `AUTH_INST_01`    |
| Service Key               | `AUTH_KEY_01`     |

> Replace the example values with the actual values from your environment.

---

## 1. Login to Cloud Foundry

```bash
cf login --sso
```

Target the required organization and space:

```bash
cf target -o <ORG_NAME> -s <SPACE_NAME>
```

Verify:

```bash
cf target
```

---

## 2. Identify the Object Store Instance

List the available services:

```bash
cf services
```

Identify the Object Store service instance.

Example:

```text
name          service       plan
OS_INST_01    objectstore   standard
```

In this example:

```text
Object Store Instance = OS_INST_01
```

---

## 3. Bind Object Store to the Application

Bind the Object Store service to the Cloud Foundry application:

```bash
cf bind-service CF_Object_store OS_INST_01
```

Verify the binding:

```bash
cf services
```

---

## 4. Create the Authorization Service

Check the available service offerings:

```bash
cf marketplace
```

Check the available plans for the Authorization Service:

```bash
cf marketplace -s <AUTHORIZATION_SERVICE>
```

Create the Authorization Service instance:

```bash
cf create-service <AUTHORIZATION_SERVICE> <AUTHORIZATION_PLAN> AUTH_INST_01
```

For example, if your environment uses XSUAA:

```bash
cf create-service xsuaa application AUTH_INST_01
```

Check the service status:

```bash
cf service AUTH_INST_01
```

Wait until the service creation has completed successfully.

---

## 5. Bind Authorization Service to the Application

Bind the Authorization Service:

```bash
cf bind-service CF_Object_store AUTH_INST_01
```

Verify:

```bash
cf services
```

The application should now have both services bound:

```text
CF_Object_store
 ├── OS_INST_01
 └── AUTH_INST_01
```

---

## 6. Generate Client Credentials

Create a service key for the Authorization Service:

```bash
cf create-service-key AUTH_INST_01 AUTH_KEY_01
```

Verify the service key:

```bash
cf service-keys AUTH_INST_01
```

---

## 7. Get the Client ID

Retrieve the service key:

```bash
cf service-key AUTH_INST_01 AUTH_KEY_01
```

The output will contain credentials similar to:

```json
{
  "clientid": "<CLIENT_ID>",
  "clientsecret": "<CLIENT_SECRET>",
  "url": "<AUTHORIZATION_URL>",
  "token_url": "<TOKEN_URL>"
}
```

Collect the following values:

* `clientid`
* `token_url` / token URI

> **Security:** Do not share or commit the `clientsecret`. Treat it as a sensitive credential.

---

## 8. Configure the Object Store Instance

Set the application environment variable using the client ID.

```bash
cf set-env CF_Object_store <CLIENT_ID> OS_INST_01
```

For example:

```bash
cf set-env CF_Object_store <CLIENT_ID> OS_INST_01
```

> **Note:** The exact environment-variable name depends on the application's configuration. If the application expects a fixed variable name, use that name instead.

For example:

```bash
cf set-env CF_Object_store OBJECT_STORE_INSTANCE OS_INST_01
```

---

## 9. Configure `AUTH_TOKEN_URL`

Set `AUTH_TOKEN_URL` using the token URI obtained from the Authorization Service:

```bash
cf set-env CF_Object_store AUTH_TOKEN_URL "<TOKEN_URL>"
```

Example:

```bash
cf set-env CF_Object_store AUTH_TOKEN_URL "https://<authorization-host>/oauth/token"
```

---

## 10. Verify Environment Variables

Check the application environment:

```bash
cf env CF_Object_store
```

Verify that the required configuration is present:

```text
AUTH_TOKEN_URL
<CLIENT_ID> = OS_INST_01
```

Do not expose or commit sensitive credentials such as `clientsecret`.

---

## 11. Restart the Application

Restart the Cloud Foundry application to apply the new configuration:

```bash
cf restart CF_Object_store
```

Check the application status:

```bash
cf app CF_Object_store
```

Expected status:

```text
requested state: started
```

---

## Complete Command Sequence

```bash
# Login
cf login --sso

# Target organization and space
cf target -o <ORG_NAME> -s <SPACE_NAME>

# List services
cf services

# Bind Object Store
cf bind-service CF_Object_store OS_INST_01

# Check marketplace
cf marketplace

# Create Authorization Service
cf create-service <AUTHORIZATION_SERVICE> <AUTHORIZATION_PLAN> AUTH_INST_01

# Bind Authorization Service
cf bind-service CF_Object_store AUTH_INST_01

# Generate client credentials
cf create-service-key AUTH_INST_01 AUTH_KEY_01

# Get client credentials
cf service-key AUTH_INST_01 AUTH_KEY_01

# Configure Object Store instance
cf set-env CF_Object_store <CLIENT_ID> OS_INST_01

# Configure token URL
cf set-env CF_Object_store AUTH_TOKEN_URL "<TOKEN_URL>"

# Verify environment
cf env CF_Object_store

# Restart application
cf restart CF_Object_store

# Verify application
cf app CF_Object_store
```

## Validation Checklist

* [ ] Object Store service instance identified.
* [ ] Object Store bound to the Cloud Foundry application.
* [ ] Authorization Service created.
* [ ] Authorization Service bound to the application.
* [ ] Client credentials generated.
* [ ] Client ID collected.
* [ ] Object Store instance configured in the application environment.
* [ ] `AUTH_TOKEN_URL` configured.
* [ ] Application restarted.
* [ ] Application status is `started`.
* [ ] Application logs show no authentication or Object Store configuration errors.

## Troubleshooting

### Check Application Status

```bash
cf app CF_Object_store
```

### Check Environment Variables

```bash
cf env CF_Object_store
```

### View Recent Logs

```bash
cf logs CF_Object_store --recent
```

### Check Object Store Service

```bash
cf service OS_INST_01
```

### Check Authorization Service

```bash
cf service AUTH_INST_01
```

### Check Service Keys

```bash
cf service-keys AUTH_INST_01
```

### Retrieve Service Key

```bash
cf service-key AUTH_INST_01 AUTH_KEY_01
```

> **Warning:** The service-key output may contain sensitive credentials. Do not paste it into tickets, source control, or public documentation.
