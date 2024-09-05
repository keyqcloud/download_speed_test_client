# download_speed_test_client

Client scripts to test downloads of static files and streams.

## Installation

### Amazon Linxu 2023

Install necessary packages and libraries. I like to also install tmux so I can run the process on a tmux session and detach from it so that the process doens't quit if the SSH session disconnects.
```
sudo dnf update -y
sudo dnf install nodejs -y
sudo dnf install -y \
  alsa-lib \
  atk \
  cups-libs \
  gtk3 \
  libXcomposite \
  libXcursor \
  libXdamage \
  libXext \
  libXi \
  libXrandr \
  libXScrnSaver \
  libXtst \
  pango \
  xorg-x11-fonts-Type1 \
  xorg-x11-fonts-misc
sudo dnf install -y xorg-x11-server-Xvfb
sudo dnf install -y libgbm libxshmfence
sudo dnf install -y git
sudo dnf install -y tmux
```

Clone the repository and install the npm packages
```
git clone https://github.com/keyqcloud/download_speed_test_client
npm install
```

Open a tmux session to run the program
```
tmux
node <script-name>.js
```
To detach from a session, press `Ctrl-b + d`
