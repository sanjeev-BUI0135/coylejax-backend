## Prerequisites
Before you begin, ensure the following are installed on your Windows system:

- [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) → Install Guide

just click,
Docker Desktop for Windows - x86_64

## Git
Switch to your Respective branch (example: if feature/phase1-api, 'git checkout feature/phase1-api'):

## Start Docker Containers
Make sure Docker Desktop is running,

## Command to run start the docker containers

docker-compose up --build -d
    
This will Build and start all containers defined in the docker-compose.yml file
Automatically set up the development environment

## Verify Containers
Open Docker Desktop go to the Containers tab confirm all required containers are running

## Access the Application
http://localhost:3001

## Code Updates
Any local code changes will automatically reflect in the running container — no manual rebuild needed.

## Stop Containers
To stop and remove all running containers,

docker-compose down