# Object Store App

Object Store App is a Node.js/Express service that presents a single REST API over AWS S3, Azure Blob Storage, and Google Cloud Storage. It is intended for SAP BTP / Cloud Foundry deployments: an XSUAA access token selects the Object Store service instance, and the service resolves that instance's bound credentials at request time.

The application also includes Swagger UI and optional, destination-driven encryption for uploaded objects.

## Capabilities

- List objects and logical folders, create folder markers, download, copy, move, and delete objects.
- Upload an object in one request, asynchronously, or through a temporary chunked-write session.
- Select AWS, Azure, or GCP automatically from the bound Object Store credentials.
- Authenticate every `/Storage` request with XSUAA and restrict it to the Object Store instance encoded in the token.
- Encrypt uploads and decrypt downloads with AES-256-GCM, RSA hybrid encryption, or OpenPGP when a crypto destination is configured.
- Serve interactive API documentation at `/swagger/`.

## Project structure

```text
object-store-app/
├── public/                         # Swagger UI assets and OpenAPI specification
│   ├── openapi.json                 # REST API contract
│   └── index.html                   # Swagger UI entry page
├── src/
│   ├── app.js                       # Express setup, static assets, and server startup
│   ├── security.js                  # XSUAA token validation and service-instance resolution
│   ├── storageRouter.js             # /Storage routes and HTTP response handling
│   ├── storageAdapter.js            # Selects the AWS, Azure, or GCP provider
│   ├── destinationAdapter.js        # Reads SAP Destination properties
│   ├── cryptoAdapter.js             # Resolves and caches crypto configuration
│   ├── providers/
│   │   ├── awsProvider.js           # Amazon S3 implementation
│   │   ├── azureProvider.js          # Azure Blob Storage implementation
│   │   └── gcpProvider.js           # Google Cloud Storage implementation
│   ├── strategies/
│   │   ├── baseStrategy.js           # Encryption strategy contract
│   │   ├── aesStrategy.js            # AES-256-GCM implementation
│   │   ├── pgpStrategy.js            # OpenPGP implementation
│   │   └── rsaStrategy.js            # RSA-OAEP + AES-256-GCM implementation
│   └── utils/
│       ├── pipelineUtils.js          # Upload encryption and download decryption pipeline
│       ├── requestUtils.js           # Parameter, path, and binary-body helpers
│       └── sessionUtils.js           # Temporary, chunked-upload session management
├── .env.example                     # Local environment-variable template
├── default-env.jsonc                # Example Cloud Foundry-style local bindings
├── manifest.yml                     # Cloud Foundry deployment manifest
└── package.json                     # Scripts, dependencies, and Node.js requirement
```

## Prerequisites

- Node.js 18 or later
- An XSUAA binding for authentication
- An Object Store service binding with credentials for one supported cloud provider
- SAP Destination service configuration only when encryption is required

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and set the required local values. `PORT` defaults to `4004`.

3. Provide Cloud Foundry-style service bindings through `VCAP_SERVICES` or a local `default-env.json`. The application loads bindings with `@sap/xsenv`; do not commit real credentials or keys.

4. Start the service:

   ```bash
   npm start
   ```

5. Open Swagger UI at [http://localhost:4004/swagger/](http://localhost:4004/swagger/). The OpenAPI document is also available at `/swagger/openapi.json` and `/openapi.json`.

## Configuration and authorization

`security.js` validates every request below `/Storage` against a bound XSUAA service. It derives configuration from authorities in the access-token payload, using the application client ID as the authority prefix.

- `OS:<object-store-service-instance>` is required. It identifies the Object Store binding to use for the request.
- `ENC_DST:<destination-name>` is optional. It selects the SAP Destination containing encryption settings.

The service returns `401` for an invalid token, `400` when the required Object Store attribute or provider credentials are unavailable, and `500` when no XSUAA binding is configured.

## Storage-provider credentials

Provider selection is automatic, based on properties in the resolved Object Store binding:

| Provider | Required credential shape |
| --- | --- |
| AWS S3 | `access_key_id`, `secret_access_key`, `bucket`; `region` is passed to the AWS SDK |
| Google Cloud Storage | `bucket` plus `base64EncodedPrivateKeyData`, or `private_key` / `gcpKey` credentials |
| Azure Blob Storage | Azure account/container/SAS properties, `container_uri` plus `sas_token`, or a `connection_string` |

Folders are represented by an empty `.init` marker object because object stores do not have native directories.

## API overview

All storage operations are rooted at `/Storage` and require `Authorization: Bearer <access-token>`. Parameters can be supplied in the query string, request body, route path, or matching header; paths are normalized to relative, slash-separated paths.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/Storage/list` | List objects and folders. Supports `startIn`, `recursive`, and `foldersOnly`. |
| POST | `/Storage/createPath` | Create a logical folder for `path`. |
| GET | `/Storage/get` | Download the object at `location`. |
| GET | `/Storage/getChunk` | Read `location` by `Line`, `Binary`, or `None` chunk mode. |
| POST | `/Storage/post` | Upload a binary request body to `location`. |
| POST | `/Storage/postasync` | Start an asynchronous upload to `location`; returns an upload ID. |
| POST | `/Storage/copy` | Copy `sourcePath` to `destinationPath`. |
| POST | `/Storage/move` | Move `sourcePath` to `destinationPath`. |
| DELETE | `/Storage/delete` | Delete `location`. |
| GET | `/Storage/listWritable` | List active temporary upload sessions. |
| GET | `/Storage/getWritable/{fileName}` | Read an active upload session. |
| POST | `/Storage/writeStart/{fileName}` | Create a chunked upload session with the initial binary payload. |
| POST | `/Storage/writeChunk/{fileName}` | Append a binary payload to the session. |
| POST | `/Storage/writeComplete/{fileName}` | Upload the session; accepts `destination` and/or `storagePath`. |
| POST | `/Storage/writeCancel/{fileName}` | Cancel the session and remove its temporary file. |
| GET | `/Storage/uploadStatus/{uploadId}` | Get asynchronous or active upload status. |

Refer to Swagger UI for request schemas, examples, and response details.

## Upload behavior

Single-request uploads use `POST /Storage/post`. For larger or streamed client workflows, create a writable session with `writeStart`, append data with `writeChunk`, then persist it with `writeComplete`. Session data is stored under the operating system temp directory in `object_store_temp` and is lazily removed after one hour; completed and cancelled sessions are removed immediately.

The maximum parsed request body size is 100 MB for JSON, `application/octet-stream`, and `text/plain` requests.

## Optional encryption

When a crypto destination is selected and its settings are valid, uploads are encrypted before provider upload. Encryption metadata is written with the object, and downloads use that metadata to decrypt the payload.

Configure these Destination properties:

| Property | Description |
| --- | --- |
| `ENCRYPTION_ALGORITHM` | `aes`, `rsa`, or `pgp` |
| `ENCRYPTION_FORMAT` | `binary` (default) or `armored` / `ascii` / `base64` |
| `ENCRYPTION_PUBLIC_KEY` | Required for RSA or PGP encryption |
| `ENCRYPTION_PRIVATE_KEY` | Used for RSA/PGP decryption or as an AES key |
| `ENCRYPTION_PASSPHRASE` | Optional PGP/RSA private-key passphrase or AES key-derivation input |

Public and private keys may be supplied as PEM/armored text or Base64-encoded PEM/armored text. Crypto configuration is cached in memory for 10 minutes.

## Deploy to Cloud Foundry

Update [manifest.yml](manifest.yml) for the target space and bind the required XSUAA and Object Store services. Then deploy with:

```bash
cf push
```

The manifest starts the application with `node src/app.js`, allocates 512 MB memory and disk, and uses the Node.js buildpack.

## Notes

- There is currently one npm script: `npm start`.
- The service does not include a local filesystem storage provider or an automated test suite.
- `default-env.json` may contain environment-specific service bindings; treat it as sensitive configuration.

## License

This project is provided as a sample application for object-storage integration.
