# Google App Script Conversational Telegram Bot

  

A conversational bot hosted on Google App script for free available 24/7.

  

Thanks to the power of Google services all linked together, GAS-conversational-telegram-bot support conversation in private chats and groups. It's implementation is easy and fast.

  

## Prerequisites

1. Google Account

2. Telegram Account

3. Knowing Javascript

  

## Installation Guide

1. Open telegram and search for [@BotFather](https://t.me/BotFather)

2. Ask to create a new bot and follow the steps

3. Write down the bot Token

4. Open your Google Account and go to Google Drive

5. Create a folder named as your telegram bot

6. Inside the folder create a Google Spreadsheet and write down the spreadsheetId (https://docs.google.com/spreadsheets/d/*spreadsheetId*/edit)

7. Open up the spreadsheet and go to Extensions -> App Script. This will open the app script editor

8. Delete the default .gs file and recreate each file in this repository (1-Bot.gs, 2-handlers.gs and 3-main.gs) and save all
> Note that the numbers in fron of each file name are used by App Script for correct ordering during deployment.
9. Click on "execute deployment" -> "new deployment" and choose "web app" as type, "execute as me" and "everyone can access". Click on execute deployment and keep from the result url the webAppId (https://script.google.com/macros/s/*webAppId*/exec) 
10.  Go to "project settings" and add 4 script properties, then save:
  * botToken=the value that you keep from point 3
  * devList=a comma separated text of telegramIds of the developers of the bot (you can get yours by interrogating [@userinfobot](https://t.me/userinfobot) )
  * spreadsheetId=the value that you keep from point 6
  * webAppId=the value that you keep from point 9

Congratulations! You have started your first conversational bot!
