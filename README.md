# 5MindApp

A Linux desktop client for the 5mind website.

## Description

5MindApp is a native Linux wayland only client designed to provide a seamless and efficient desktop experience for users of the 5mind website. This application allows users to access 5mind features directly from their Linux environment, offering potential advantages such as improved performance, offline capabilities, notifications, or a more integrated user interface compared to browser-based access.

## Features

- Direct access to 5mind website functionality
- Native Linux integration

## Installation
go to the releases tab and download the app note flatpak support is unoffical to install the flatpak verison please flow the Provide step-by-step installation instructions :

```bash
# Clone the repository
git clone https://github.com/EchoRavenX/5mindapp.git

# Navigate to the project directory
cd 5mindapp
 flatpaks build, thanks to Shonubot for helping me. 
you need to install
flatpak install flathub org.freedesktop.Sdk.Extension.node22/x86_64/25.08
flatpak install flathub org.electronjs.Electron2.BaseApp//25.08
and run ./packageflatpak.sh
