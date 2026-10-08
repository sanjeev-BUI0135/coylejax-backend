# Backend Deployment to EC2 (Staging)

This repository uses **GitHub Actions** to automatically deploy the `coylejax-backend` application to an **AWS EC2 staging server** whenever changes are pushed to the `staging` branch.

The workflow securely syncs backend source code to the EC2 instance, installs dependencies, and restarts the application using **PM2**.

---

## Environment Type

**Staging (Demo)**

This workflow deploys code directly to the Staging environment. Changes will immediately affect end users.

---

## Workflow Trigger

The deployment workflow runs in the following cases:

* **Automatic trigger**: On every push to the `staging` branch
* **Manual trigger**: Via the **Run workflow** option in GitHub Actions

---

## Workflow Overview

The deployment process includes the following steps:

1. Checkout the latest backend source code
2. Configure self-hosted runner for communicate with ec2 machine
3. Sync backend files using `rsync`
4. Install Node.js dependencies on the server
5. Restart the backend service using PM2

---

## Backend Deployment Using rsync

The backend source code is uploaded to the EC2 server using `rsync` with selective exclusions:

* Environment files are preserved
* Uploaded user data is not overwritten
* Git and GitHub workflow files are excluded

This ensures only application-relevant files are updated on the server.

**Important:** The `--delete` flag removes any server-side files that do not exist in the repository (except excluded paths).

---

### Excluded Paths

| Path       | Reason                              |
| ---------- | ----------------------------------- |
| `.env`     | Contains live credentials           |
| `uploads/` | Live images Upload path             |
| `.git`     | Git data not needed on server       |
| `.github`  | CI/CD files not required at runtime |

---

## Deployment Directory on EC2

The backend is deployed to:

```
/home/ubuntu/staging/coylejax-backend
```

Ensure that:

* The directory exists
* The EC2 user owns the directory
* Correct permissions are applied

---

## Dependency Installation & PM2 Restart

After syncing files, the workflow executes the following steps on the EC2 server:

* Targets the backend directory
* Install Node.js dependencies
* Restarts the backend service using PM2
* Saves the PM2 process list for persistence

```bash
npm install
pm2 restart coylejax-api
pm2 save
pm2 ls
```

This guarantees the backend runs with the latest code and dependencies.

---

## PM2 Staging Requirements

The following must already be configured on the EC2 server:

* Node.js installed
* PM2 installed globally
* A PM2 process named `coylejax-api`

---

## Summary

* Automated backend deployment using GitHub Actions
* Secure self-hosted runner with Github Organization level setup
* Controlled file synchronization with `rsync`
* Safe handling of environment files and uploads
* Zero-downtime restarts using PM2

---

**Maintained by:** BrightUI DevOps Team