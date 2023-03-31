
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

6. Inside the folder create a Google Spreadsheet and write down the spreadsheetId that you can get from the url (https://docs.google.com/spreadsheets/d/*spreadsheetId*/edit)

7. Open up the spreadsheet and go to Extensions -> App Script. This will open the app script editor

8. Delete the default .gs file and copy/paste each file in this repository (1-Bot.gs, 2-handlers.gs and 3-main.gs) and save all
> Note that the numbers in fron of each file name are used by App Script for correct ordering during deployment.
9. Click on "execute deployment" -> "new deployment" and choose "web app" as type, "execute as me" and "everyone can access". Click on execute deployment and keep from the result url the webAppId (https://script.google.com/macros/s/*webAppId*/exec) 
10.  Go to "project settings" and add 4 script properties, then save:
  * `botToken`=the value that you keep from point 3
  * `devList`=a comma separated text of telegramIds of the developers of the bot (you can get yours by interrogating [@userinfobot](https://t.me/userinfobot) )
  * `spreadsheetId`=the value that you keep from point 6
  * `webAppId`=the value that you keep from point 9

Congratulations! You have started your first conversational bot!

## But how it works?
### The command handler
The command handler is a function that is called when the user write a command to the bot. It takes in input 3 parameters and does not return anything:
  * `bot`: the bot itself. You can use all the function of the bot such as 'sendMessage'
  * `params`: if the user send a command with a space separate text, the params is valued with text after the command (e.g. /command 1234 <- 1234 is the params)
  * `message`: the message in the sense of the object we receive from telegram (see this [link](https://core.telegram.org/bots/api#message))

Here is an example of a command handler:
```
const start = function(bot, params, message) {
	bot.sendMessage(message.chat.id, "Hi " + message.from.first_name + "!\nThis is the starting message from the bot, an example bot used to learn how to host telegram bot code inside Google App Script.\nTo see all the commands available use /help");
}
```

### The conversation handler
The conversation handler is an object consisting of 4 properties defined as follows:
  * `entry`: The function that is called when starting a conversation
  * `states`: An array of functions called in sequence that represents the current state of the conversation. Each state have to return the next position in the list in order to continue the conversation. But if there is an error on what the user has sent, you can return the current position and re-request a text from the user. Even the last state have to return the next position but the bot will handle it and call the 'final' function.
  * `final`: The last function that is called after the last state function. Usually in this function you can process all the input received in the states function
  * `fallback`: an object like a small command handler that is used to stop and cancel the current conversation. This object is composed of command (string) and handler (function)

Here is an example of a conversation handler:
```
{
	entry: newConversation,
	states: [
		{type: "str", handler: addName},
		{type: "date", handler: addStartDate},
		{type: "date", handler: addEndDate}
	],
	final: endConversation,
	fallback: {
		command: "/cancel",
		handler: cancel
	}
}
```

### How to add a new handler
The bot provides a function called addHandler that takes 4 parameters in input:
  * `command`: a string that starts the function or the conversation
  * `description`: a brief description of the commands. Useful with the default /help handler to show the user all bot functions
  * `type`: a string representing the type of the handler to be added (currently not in use)
  * `callback`: a function in the case of command handler or an object in the case of conversation handler

Here is an example of adding an handler:
```
BOT.addHandler("/help", "View all commands you can use", "command", help);

BOT.addHandler("/conv", "start a conversation", "conversation", {
	entry: newConversation,
	states: [
		{type: "str", handler: addName},
		{type: "date", handler: addStartDate},
		{type: "date", handler: addEndDate}
	],
	final: endConversation,
	fallback: {
		command: "/cancel",
		handler: cancel
	}
});
```

## Pros and cons
### Strengths
It's easy to set up and add as many handlers as you want. You don't have to worry about writing the bot request or response functions because they are already present.
### Weaknesses
Due to the use of many different services such as Google App Script, Google Spreadsheets and the Telegram server for bots, each response from the bot may take several seconds to process.
For now, the supported Telegram Bot APIs are only for sending simple text messages.

## Acknowledgements
A big thanks goes to [python-telegram-bot](https://github.com/python-telegram-bot/python-telegram-bot) for inspiring a lot for this repository.

Another big thank you goes out to you for stopping by and reading the whole description (also somewhat poorly written) and leaving a star!
