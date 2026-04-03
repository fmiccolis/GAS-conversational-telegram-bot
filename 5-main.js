const BOT = new TelegramBot(
  ScriptProperties.getProperty("botToken"), // ask @BotFather on telegram for your botToken
  ScriptProperties.getProperty("webAppId"), // after deployment as webApp, AppScript will give you the webAppId
  ScriptProperties.getProperty("spreadsheetId"), // in order to work the TelegramBot object need a spreadsheet
  ScriptProperties.getProperty("devList") // a comma separated string with the telegramIds of the developers
);
registerHandlers(BOT)

function doPost(e) {
  BOT.dispatcher(JSON.parse(e.postData.contents));
}

function testFunction() {
  BOT.simulateDispatch("test Function")
}

function firstLaunch() {
  BOT.firstLaunch()
}

function clearMessagesSheet() {
  BOT.resetSentSheet()
  BOT.resetReceivedSheet()
}

function clearConversationSheet() {
  BOT.resetConversationSheet()
}