{
  "name": "ai-model-tuner-pro",
  "version": "1.0.0",
  "description": "Desktop tool to recommend inference settings for AI models on Windows — PRO edition with benchmarks, compatibility, and export profiles",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "pack": "electron-builder --win dir",
    "dist": "electron-builder --win"
  },
  "author": "",
  "license": "MIT",
  "devDependencies": {
    "@electron/asar": "^4.2.0",
    "electron": "^31.0.0",
    "electron-builder": "^24.13.3"
  },
  "dependencies": {
    "electron-log": "^4.4.8",
    "electron-updater": "^6.1.8",
    "systeminformation": "^5.22.12"
  },
  "build": {
    "appId": "com.heinebraeck.ai-model-tuner-pro",
    "productName": "AI Model Tuner PRO",
    "copyright": "Copyright © 2025",
    "win": {
      "target": [
        {
          "target": "nsis",
          "arch": [
            "x64",
            "ia32"
          ]
        },
        {
          "target": "portable",
          "arch": "x64"
        }
      ],
      "icon": "logo.png"
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true
    },
    "files": [
      "**/*",
      "!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}",
      "!**/node_modules/*/{test,tests,testing,powered-test,example,examples}",
      "!**/node_modules/*.json",
      "!**/node_modules/*.txt"
    ],
    "directories": {}
  }
}
