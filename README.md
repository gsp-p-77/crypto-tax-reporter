# GSwPersonalWebPage
Crypto tax reporter

## Introduction

Do you need support with taxes, required for crypto profits in Germany?

This web application supports you to capture all of your personal crypto transactions and to generate PDF exports for the tax calculation.

### Features

The web application covers the following use case:
- Add transactions
  - Buy BTC on Strike wallet
  - Transfer BTCs from Strike to Cold wallet (to be implemented)
  - Transfer BTCs from cold wallet back to Strike (to be implemented)
  - Sell BTC from Strike wallet (to be implemented)
- View transactions
- Generate PDF export for the tax office

## Prerequisites and usage

This web application needs the following setup on your server
- install nodejs and npm for Windows or Linux 
- install required packages with npm install
- start application with npm start or for debugging with nodemon index.js

Afterwards the web application, if hosted locally, is available in your browser here:
localhost:3000

The web application stores all date in a JSON file below ./data/ in transactions.json

The rest should be self explaining.

Have fun!
 
