const BOT = new TelegramBot(
  ScriptProperties.getProperty("botToken"), // ask @BotFather on telegram for your botToken
  ScriptProperties.getProperty("webAppId"), // after deployment as webApp, AppScript will give you the webAppId
  ScriptProperties.getProperty("spreadsheetId"), // in order to work the TelegramBot object need a spreadsheet
  ScriptProperties.getProperty("devList") // a comma separated string with the telegramIds of the developers
);

BOT.addHandler("/start", "Start your journey with the bot", "command", start);
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
})

function doPost(e) {
  BOT.dispatcher(JSON.parse(e.postData.contents));
}

function initializeBot() {
  BOT.firstLaunch();
}

function generateEntities(text = "") {
  let count = (text.match(/\//g) || []).length;
  if(count === 0) return null;
  var entities = [];
  var searchFrom = 0;
  for(let i = 0; i < count; i++) {
    var offset = text.indexOf("/", searchFrom);
    var length = text.indexOf(" ", searchFrom);
    entities.push({
      "offset": offset,
      "length": length > -1 ? length : text.length,
      "type": "bot_command"
    })
    searchFrom += length + 1;
  }
  return entities;
}

function simulateTelegramMessage(text) {
  var firstDev = BOT.devList[0];
  var fromObj = {"id": firstDev, "first_name": "FirstName", "last_name": "LastName", "username": "Username", "language_code": "en", "is_bot": false}
  var chatObj = {"id": firstDev, "first_name": "FirstName", "last_name": "LastName", "username": "Username", "type": "private"}
  return {
    "update_id": 143823073,
    "message": {
      "from": fromObj,
      "chat": chatObj,
      "date": Math.floor(new Date().getTime()/1000),
      "text": text,
      "entities": generateEntities(text)
    }
  } 
}

function testFunction() {
  var contents = simulateTelegramMessage("30-03-2023");
  //Logger.log(JSON.stringify(contents, null, 2));
  BOT.dispatcher(contents);
}

function clearMessageSheet() {
  BOT.resetReceivedSheet();
  BOT.resetSentSheet();
}

function clearConversationSheet() {
  BOT.expireConversation();
}