# Object Store App

A standalone Node.js application for managing object storage across multiple cloud providers and local mock mode. The app exposes a REST API for listing, creating paths, uploading, downloading, copying, moving, and deleting objects, with instance-scoped security validation to prevent cross-instance access.

## Features

- Unified storage abstraction for:
  - AWS S3
  - Azure Blob Storage
  - Google Cloud Storage
  - Local mock storage for development
- Folder/path provisioning for storage instances
- File upload support with chunk-based write flow
- File download, delete, copy, and move operations
- Security middleware enforcing Bearer-token authentication and instance matching
- Browser-based UI for working with storage content locally
- Environment-driven runtime configuration for local or deployed usage

## Project structure

- server.js: starts the Express server and serves the frontend
- app/: browser UI files
- src/
  - security.js: auth middleware
  - storageRouter.js: REST routes for storage operations
  - storageAdapter.js: provider selection logic
  - providers/: cloud-specific implementations
- .env.example: sample environment variables
- xs-security.json: SAP XSUAA security config
- xs-secutiry.js: JavaScript version of the XSUAA config
- mta.yaml: SAP Cloud Deployment descriptor

## Runtime behavior

The app listens on a configurable port and exposes storage routes under the /Storage base path. Requests require a valid Authorization header in the form Bearer <token> and a matching x-storage-location header. The security middleware validates that the authenticated ABAP instance matches the route instance, which prevents requests from targeting another storage location.

In local development, the app can run with MOCK_LOCAL_STORAGE=true to simulate authenticated access using a base64-encoded mock token payload such as:

- user
- abap_instance

When running in production mode without mock storage, the app expects a real configured runtime and Cloud Foundry or SAP destination environment rather than the local mock path.

## Local development

1. Install dependencies:

   npm install

2. Copy the sample environment file:

   copy .env.example .env

3. Start the application:

   npm start

4. For automatic reload during local development:

   npm run dev

## Environment variables

The application supports the following environment variables:

- PORT: application port, default 4004
- NODE_ENV: runtime mode, typically development or production
- MOCK_LOCAL_STORAGE: enables local mock auth and local storage behavior when set to true
- VCAP_SERVICES: Cloud Foundry service bindings for object storage

Example configuration:

PORT=4004
MOCK_LOCAL_STORAGE=true
NODE_ENV=development
VCAP_SERVICES={}

## API overview

The application routes under /Storage and supports these endpoints:

- POST /Storage/:destinationName/createPath
- GET /Storage/:destinationName/list
- POST /Storage/:destinationName/copy
- POST /Storage/:destinationName/move
- GET /Storage/:destinationName/get
- DELETE /Storage/:destinationName/delete
- POST /Storage/writeStart/:fileName
- POST /Storage/writeChunk/:uploadId
- POST /Storage/writeComplete/:uploadId
- POST /Storage/writeCancel/:uploadId
- GET /Storage/uploadStatus/:uploadId

The browser UI uses these APIs to manage files and folders for a configured storage instance.

## Storage provider adapters

The app chooses a provider based on runtime environment and service bindings:

- AWS S3: uses credentials from VCAP_SERVICES or SAP destination metadata
- Azure Blob Storage: uses connection string, SAS URL, or destination configuration
- Google Cloud Storage: uses service account credentials and bucket metadata
- LocalMockProvider: used in local mock mode for tests and offline development

## Security model

The app uses a lightweight middleware authorization layer:

- If MOCK_LOCAL_STORAGE=true or NODE_ENV is not production, a Bearer token is expected in the Authorization header.
- The token is decoded from base64 JSON and must contain the user and abap_instance values.
- The x-storage-location header or destination path must match the provided ABAP instance value.
- If the values do not match, the request is rejected with a 403 response.

## Deployment notes

This project includes SAP deployment metadata for BTP-style packaging:

- mta.yaml: Multi-target application descriptor
- xs-security.json: security configuration for XSUAA
- xs-secutiry.js: JavaScript representation of the security definition

This app is intended to be deployed as a Node.js module with an XSUAA service and runtime storage bindings.

## Notes

- The app serves the frontend from the app folder and exposes the API from the same server instance.
- Temporary upload chunks are stored in the tmp_storage_chunks directory.
- Local mock mode is intended for development and demonstration workflows rather than production usage.

## Suggested next steps

- Configure a real object store binding in the target environment.
- Add a proper production authentication provider instead of the local mock auth flow.
- Extend the UI with additional validation, bulk operations, or progress indicators.

## License

This project is provided as a sample application for object storage integration and is intended for development or demonstration use.
