# Object Store App

A standalone Node.js application for managing object storage across multiple cloud providers. The app exposes a REST API for listing, creating paths, uploading, downloading, copying, moving, and deleting objects, with instance-scoped security validation to prevent cross-instance access.

## Features

- Unified storage abstraction for cloud object stores:
  - AWS S3
  - Azure Blob Storage
  - Google Cloud Storage
- Folder/path provisioning for storage instances
- File upload support with chunk-based write flow
- File download, delete, copy, and move operations
- Security middleware enforcing Bearer token authentication and instance matching
- Browser-based UI for working with storage content
- Environment-driven runtime configuration for Cloud Foundry and SAP BTP

## Project Structure

- `server.js`: starts the Express server and serves the readme file
- `src/`
  - `security.js`: Bearer token authorization middleware
  - `storageRouter.js`: REST routes for storage operations
  - `storageAdapter.js`: Cloud provider selection logic (AWS, Azure, GCP)
  - `providers/`: cloud vendor integrations
- `test/`: isolated testing harness for local development and testing
  - `mockProvider.js`: local filesystem mock storage implementation for offline tests
  - `mockAuth.js`: mock auth middleware for test suites
  - `testServer.js`: local test server runner
  - `storage.test.js`: automated API integration tests
- `.env.example`: sample environment variables
- `manifest.yml`: Cloud Foundry manifest descriptor
- `xs-security.json`: SAP XSUAA security configuration

## Runtime Behavior

The application listens on a configurable port and exposes storage routes under the `/Storage` base path. Requests require a valid `Authorization: Bearer <token>` header. The security middleware validates that the authenticated instance matches the target destination parameter.

## Local Development & Testing

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run automated unit/integration tests:

   ```bash
   npm test
   ```

3. Launch local mock test server:

   ```bash
   npm run test:server
   ```

4. Start standard production server:

   ```bash
   npm start
   ```

5. Access Swagger UI API Documentation:

   Open `http://localhost:4004/swagger/` in your browser.

## Environment Variables

The application supports the following environment variables:

- `PORT`: application port, default 4004
- `NODE_ENV`: runtime mode (development / production)
- `VCAP_SERVICES`: Cloud Foundry service bindings for object storage credentials

## API Overview

The application routes under `/Storage` and supports these endpoints:

- `POST /Storage/:destinationName/createPath`
- `GET /Storage/:destinationName/list`
- `POST /Storage/:destinationName/copy`
- `POST /Storage/:destinationName/move`
- `GET /Storage/:destinationName/get`
- `GET /Storage/:destinationName/getChunk`
- `DELETE /Storage/:destinationName/delete`
- `POST /Storage/:destinationName/setStorage`
- `GET /Storage/listWritable`
- `GET /Storage/getWritable/:fileName`
- `POST /Storage/writeStart/:fileName`
- `POST /Storage/writeChunk/:fileName`
- `POST /Storage/writeComplete/:fileName`
- `POST /Storage/writeCancel/:fileName`
- `GET /Storage/uploadStatus/:uploadId`

## Storage Provider Adapters

The app chooses a provider dynamically based on service bindings (`VCAP_SERVICES`) or SAP Destination configuration:

- **AWS S3**: configured via AWS S3 credentials / bucket settings
- **Azure Blob Storage**: configured via Azure connection string / SAS URL
- **Google Cloud Storage**: configured via GCP service account credentials

## Security Model

- Expects a Bearer token in the `Authorization` header.
- Validates user identity and `object_store_instance` attributes.
- Enforces path-level instance authorization checks.

## Deployment Notes

- `manifest.yml`: Cloud Foundry manifest descriptor for `cf push`
- `xs-security.json`: Security configuration for XSUAA service binding

## License

This project is provided as a sample application for object storage integration.
