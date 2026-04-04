# Google Apps Script — Conversational Telegram Bot

A conversational Telegram bot hosted on Google Apps Script, available 24/7 at no cost.

Thanks to the integration between Google services, the bot supports multi-step conversations in both private chats and groups. Setup is fast and requires no external server.

---

## Prerequisites

- Google Account
- Telegram Account
- Basic knowledge of JavaScript
- [Node.js](https://nodejs.org/) (v14 or later)

---

## Installation

### 1. Create the Telegram bot

Open Telegram and search for [@BotFather](https://t.me/BotFather). Create a new bot and note down the **token**. Then send a `/start` message to your bot (it won't reply, but it initialises the conversation on Telegram's side).

### 2. Create the Google Spreadsheet

In Google Drive, create a folder named after your bot and inside it create a **Google Spreadsheet**. Note down the `spreadsheetId` from the URL:
```
https://docs.google.com/spreadsheets/d/<spreadsheetId>/edit
```

### 3. Create the Apps Script project

Open the spreadsheet and go to **Extensions → Apps Script**. From **Project settings**, copy the **Script ID**.

### 4. Clone the repository and configure clasp

```bash
git clone https://github.com/your-username/your-repo.git
cd your-repo

# Install clasp globally
npm install -g @google/clasp

# Authenticate with your Google account
clasp login
```

Enable the **Apps Script API** at [script.google.com/home/usersettings](https://script.google.com/home/usersettings).

Then set up your local `.clasp.json`:

```bash
cp .clasp.json.example .clasp.json
```

Open `.clasp.json` and replace `YOUR_SCRIPT_ID_HERE` with the Script ID copied in step 3.

### 5. Push the code

```bash
clasp push
```

### 6. Deploy as a Web App

```bash
clasp open
```

In the editor, click **Deploy → New deployment**. Choose **Web app** as the type, set *Execute as:* **Me** and *Who has access:* **Anyone**. Confirm and note the `webAppId` from the resulting URL:
```
https://script.google.com/macros/s/<webAppId>/exec
```

### 7. Set Script properties

Go to **Project settings → Script properties** and add the following four properties:

| Property        | Value                                                                                                       |
|-----------------|-------------------------------------------------------------------------------------------------------------|
| `botToken`      | The token from step 1                                                                                       |
| `devList`       | Comma-separated list of developer Telegram IDs (use [@userinfobot](https://t.me/userinfobot) to get yours) |
| `spreadsheetId` | The ID from step 2                                                                                          |
| `webAppId`      | The ID from step 6                                                                                          |

### 8. Initialise the bot

From the Apps Script editor, run the function `initializeBot()`.

Your conversational bot is now live.

---

## Development

### Daily workflow

```bash
# Push changes to Apps Script after editing local files
clasp push

# Or enable watch mode for automatic push on every save
clasp push --watch

# Open the project in the online editor
clasp open

# View execution logs
clasp logs
```

### Project structure

```
├── .clasp.json.example   ← template for local clasp configuration
├── .claspignore          ← files excluded from clasp push
├── appsscript.json       ← Apps Script project manifest
├── .gitignore
├── README.md
├── 1-GSTable.js
├── 2-TelegramModels.js
├── 3-Bot.js
├── 4-handlers.js
└── 5-main.js
```

> **Note:** the numeric prefix in each filename ensures the correct loading order when the project is deployed on Apps Script.

---

## How it works

### Architecture

The project is split into five files, each with a single responsibility:

| File                  | Responsibility                                                                  |
|-----------------------|---------------------------------------------------------------------------------|
| `1-GSTable.js`        | Google Sheets ORM: reads, writes, and caches sheet headers                      |
| `2-TelegramModels.js` | Data models: `ReceivedMessage`, `SentMessage`, `Conversation`                   |
| `3-Bot.js`            | Bot core: dispatcher, conversation routing, Telegram API calls                  |
| `4-handlers.js`       | Application handlers: commands, conversations, error handler                    |
| `5-main.js`           | Entry point: `doPost()` and `initializeBot()`                                  |

Every incoming message follows this path:

```
Telegram → doPost() → bot.dispatcher() → _main()
                                            ├─ active conversation → _continueConversation()
                                            └─ no conversation    → _dispatchCommand()
```

---

### Command handler

A command handler is a function invoked when the user sends a command to the bot.

**Signature:** `(bot, params, message) → void`

| Parameter | Type          | Description                                                                                              |
|-----------|---------------|----------------------------------------------------------------------------------------------------------|
| `bot`     | `TelegramBot` | The bot instance. Exposes `sendMessage`, `sendPhoto`, `editMessageText`, etc.                            |
| `params`  | `string`      | Text after the command (e.g. `/start 1234` → `params = "1234"`). Empty string if absent.                |
| `message` | `Object`      | Raw Telegram message object. See the [official docs](https://core.telegram.org/bots/api#message).        |

```js
const startHandler = (bot, params, message) => {
  bot.sendMessage(
    message.chat.id,
    `Hello <b>${message.from.first_name}</b>! Type /help to see all available commands.`
  );
};
```

---

### Conversation handler

A conversation handler is an object that manages a multi-step flow. The user's answers are collected step by step and processed together at the end.

**Structure:**

| Property   | Type       | Description                                                                                        |
|------------|------------|----------------------------------------------------------------------------------------------------|
| `entry`    | `Function` | Called once when the conversation starts. Signature: `(bot, params, message) → void`.             |
| `states`   | `Array`    | Ordered array of steps. Each element has a `type` (`"text"` or `"image"`) and a `handler`.        |
| `final`    | `Function` | Called after all steps complete successfully. Signature: `(bot, payload, message) → void`.        |
| `fallback` | `Object`   | Command that interrupts the conversation. Has two fields: `command` (string) and `handler` (function). |

#### Step handler contract

Every function at `states[N].handler` receives `(bot, conversation, message)` and **must return a number**:

- `N` → invalid input; stays on the same step (e.g. validation failed)
- `N + 1` → input accepted; advances to the next step
- `states.length` → last step completed; triggers `final`

> ⚠️ Forgetting the `return` statement in a step handler throws an explicit error in the dispatcher.

#### Payload structure in `final`

```js
payload.data = [
  { type: "text",  value: "<user input>",     completed: true },
  { type: "image", value: "<photo file_id>",  completed: true },
  // ...
]
```

**Full example:**

```js
const reportHandler = {

  entry(bot, params, message) {
    bot.sendMessage(message.chat.id, "Send the report title:");
  },

  states: [
    {
      type: "text",
      handler(bot, conversation, message) {
        if (!message.text || message.text.length > 80) {
          bot.sendMessage(message.chat.id, "Invalid title. Please try again:");
          return 0;
        }
        bot.sendMessage(message.chat.id, "Now send the description:");
        return 1;
      },
    },
    {
      type: "text",
      handler(bot, conversation, message) {
        if (!message.text) {
          bot.sendMessage(message.chat.id, "Description cannot be empty. Try again:");
          return 1;
        }
        bot.sendMessage(message.chat.id, "Almost done! Send a photo:");
        return 2;
      },
    },
    {
      type: "image",
      handler(bot, conversation, message) {
        if (!message.photo) {
          bot.sendMessage(message.chat.id, "Please send a photo, not text.");
          return 2;
        }
        return 3; // equals states.length → triggers final
      },
    },
  ],

  fallback: {
    command: "/cancel",
    handler(bot, conversation, message) {
      conversation.remove();
      bot.sendMessage(message.chat.id, "❌ Report cancelled.");
    },
  },

  final(bot, payload, message) {
    const title       = payload.data[0].value;
    const description = payload.data[1].value;
    const photoFileId = payload.data[2].value;

    bot.sendPhoto(message.chat.id, `✅ <b>${title}</b>\n${description}`, photoFileId);
  },
};
```

---

### Registering handlers

Use `bot.addHandler()` to register both command and conversation handlers. All handlers should be registered inside `registerHandlers()` in `4-handlers.js`.

**Signature:** `addHandler(command, description, type, callback)`

| Parameter     | Type               | Description                                                              |
|---------------|--------------------|--------------------------------------------------------------------------|
| `command`     | `string`           | The command string (e.g. `"/start"`). Use `""` to catch plain text.      |
| `description` | `string`           | Short description shown by `/help`.                                      |
| `type`        | `string`           | `"command"` or `"callback_query"`.                                       |
| `callback`    | `Function\|Object` | A function for command handlers; an object for conversation handlers.    |

```js
function registerHandlers(bot) {
  bot.errorHandler = errorHandler;

  // Simple command handlers
  bot.addHandler("",        "Plain text fallback", "command", plainTextHandler);
  bot.addHandler("/start",  "Start the bot",       "command", startHandler);
  bot.addHandler("/help",   "Show commands",        "command", helpHandler);
  bot.addHandler("/cancel", "Cancel operation",     "command", cancelHandler);

  // Multi-step conversation handler
  bot.addHandler("/report", "Submit a new report", "command", reportHandler);
}
```

---

### KeyboardBuilder

A utility object for building Telegram keyboard markup to pass as the third argument to `sendMessage` and `sendPhoto`.

| Method                         | Description                                           |
|--------------------------------|-------------------------------------------------------|
| `KeyboardBuilder.reply(rows)`  | Custom reply keyboard (fixed buttons below the input) |
| `KeyboardBuilder.inline(rows)` | Inline keyboard (buttons attached to the message)     |
| `KeyboardBuilder.remove()`     | Removes any active reply keyboard                     |

```js
// Reply keyboard
bot.sendMessage(id, "Choose:", KeyboardBuilder.reply([["Yes", "No"]]));

// Inline keyboard
bot.sendMessage(id, "Action:", KeyboardBuilder.inline([
  [{ text: "Confirm", callback_data: "confirm" }],
  [{ text: "Cancel",  callback_data: "cancel"  }],
]));

// Remove keyboard
bot.sendMessage(id, "Done!", KeyboardBuilder.remove());
```

---

### Callback query handler

To handle inline button taps, register a handler of type `"callback_query"`. The callback receives `(bot, callbackData, callbackQuery)`.

```js
bot.addHandler("confirm", "Confirm action", "callback_query", (bot, callbackData, callbackQuery) => {
  bot.answerCallbackQuery(callbackQuery.id, "Confirmed!");
  bot.editMessageText(
    callbackQuery.message.chat.id,
    callbackQuery.message.message_id,
    "✅ Action confirmed."
  );
});
```

---

### Error handler

The error handler is called by the dispatcher whenever an unhandled exception is thrown inside any handler. Assign it to `bot.errorHandler` inside `registerHandlers()`.

**Signature:** `(bot, error, request) → void`

```js
const errorHandler = (bot, error, request) => {
  Logger.log(error.stack);

  const chatId = request.message?.chat.id;
  if (chatId) bot.sendMessage(chatId, "⚠️ An unexpected error occurred.");

  bot.sendMessageToDevs(`🚨 ${error.message}\n<pre>${error.stack}</pre>`);
};
```

---

## Bot API — main methods

| Method                                              | Description                                           |
|-----------------------------------------------------|-------------------------------------------------------|
| `sendMessage(chatId, text, keyboard?)`              | Sends an HTML text message                            |
| `sendPhoto(chatId, caption, fileId, keyboard?)`     | Sends a photo with an HTML caption                    |
| `editMessageText(chatId, msgId, text, keyboard?)`   | Edits a previously sent message                       |
| `deleteMessage(chatId, msgId)`                      | Deletes a message                                     |
| `answerCallbackQuery(queryId, text?)`               | Dismisses the loading spinner on an inline button     |
| `sendMessageToDevs(text)`                           | Sends a message to all developers in `devList`        |
| `expireConversations()`                             | Deletes expired conversations (TTL: 15 minutes)       |
| `simulateDispatch(text)`                            | Simulates an incoming message (for testing only)      |

---

## Strengths and limitations

### Strengths
- No server to manage: everything runs on Google Apps Script for free.
- Easy to extend: adding a new command takes one function and one line in `registerHandlers()`.
- Multi-step conversations and Sheets logging are handled by the framework out of the box.
- `GSTable` caches sheet headers in memory, reducing round-trips to the spreadsheet within the same execution.

### Limitations
- Each response may take a few seconds due to Apps Script cold starts and the latency between Google and Telegram services.
- Conversations have a 15-minute TTL; once expired they are deleted automatically.
- Apps Script enforces a 6-minute execution limit per invocation — not suitable for long-running tasks.

---

## Acknowledgements

Inspired by [python-telegram-bot](https://github.com/python-telegram-bot/python-telegram-bot).