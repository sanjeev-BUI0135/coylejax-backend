# Backend Deployment to EC2 (Production)

This repository uses **GitHub Actions** to deploy the `coylejax-backend` application to the **live production EC2 server**. The workflow is designed for controlled, production-safe deployments triggered from the `release/production-live` branch.

The process synchronizes backend source code, preserves critical production data, installs dependencies, and restarts the application using **PM2**.

---

## Environment Type

**Production (Live)**

This workflow deploys code directly to the live environment. Changes will immediately affect end users.

---

## Workflow Trigger

The deployment workflow runs in the following scenarios:

* **Automatic trigger**: On every push to the `release/production-live` branch
* **Manual trigger**: Via the **Run workflow** option in GitHub Actions

---

## Workflow Overview

The production deployment follows these steps:

1. Checkout the latest backend source code
2. Configure self-hosted runner for communicate with ec2 machine
3. Sync backend source code using `rsync`
4. Install Node.js dependencies on the server
5. Restart the production service using PM2

---

## Production Deployment Using rsync

The backend source code is uploaded to the EC2 server using `rsync` with selective exclusions:

* Environment files are preserved
* Uploaded user data is not overwritten
* Git and GitHub workflow files are excluded

This ensures only application-relevant files are updated on the server.  

**Critical Notice:** The `--delete` flag removes server-side files that are not present in the repository, except for explicitly excluded paths.

---

### Excluded Paths

| Path       | Reason                                      |
| ---------- | ------------------------------------------- |
| `.env`     | Contains production secrets                 |
| `uploads/` | live images upload path                     |
| `.git`     | Git data not required on server             |
| `.github`  | CI/CD files not needed at runtime           |

---

## Deployment Directory on EC2

The production backend is deployed to:

```
/home/ubuntu/coylejax-backend/
```

Ensure that:

* The directory exists
* The EC2 user owns the directory
* Correct permissions are applied

---

## Dependency Installation & PM2 Restart

After code synchronization, the workflow performs the following actions on the EC2 server:

* Installs Node.js dependencies
* Restarts the production PM2 process
* Updates environment variables
* Saves the PM2 process list for reboot persistence

```bash
npm install
pm2 restart coylejax-production --update-env
pm2 save
pm2 ls
```

This guarantees the production application runs with the latest code and configuration.

---

## PM2 Production Requirements

The following must already be configured on the EC2 server:

* Node.js installed
* PM2 installed globally
* A PM2 process named `coylejax-production`
* PM2 startup configured for system reboots

---

## Summary

* Automated **production-safe** backend deployment
* Secure self-hosted runner with Github Organization level setup
* Controlled file synchronization with `rsync`
* Protection of production secrets and uploads
* Zero-downtime restarts using PM2

---

**Maintained by:** BrightUI DevOps Team 