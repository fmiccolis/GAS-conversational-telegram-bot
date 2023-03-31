const dateRegex = /(^0[1-9]|[12][0-9]|3[01])-(0[1-9]|1[0-2])-(\d{4}$)/;

const EXAMPLE_CONVERSATION = Object.freeze({
  ADD_NAME: 0,
  ADD_START_DATE: 1,
  ADD_END_DATE: 2,
  END: 3
});

const start = function(bot, params, message) {
  bot.sendMessage(message.chat.id, "Hi " + message.from.first_name + "!\nThis is the starting message from the bot, an example bot used to learn how to host telegram bot code inside Google App Script.\nTo see all the commands available use /help");
}

const help = function(bot, params, message) {
  var command_descriptions = "Hi " + message.from.first_name + "!\nThis is the list of commands you can use with this bot\n\n";
  for(let command in bot.handlers) {
    command_descriptions += "- " + command + " : <i>" + bot.handlers[command].description + "</i>\n"
  }
  
  bot.sendMessage(message.chat.id, command_descriptions)
}

const cancel = function(bot, conversation_data, message) {
  if(typeof conversation_data === 'object' && conversation_data !== null) {
    bot.deleteConversation(conversation_data);
  }
  bot.sendMessage(message.chat.id, "conversation deleted");
}

const newConversation = function(bot, params, message) {
  var chat_id = message.chat.id;
  bot.sendMessage(chat_id, "New conversation requested.\nGive me a name.");
  return EXAMPLE_CONVERSATION.ADD_NAME;
}

const addName = function(bot, conversation_data, message) {
  var chat_id = conversation_data.chat_id;
  bot.sendMessage(chat_id, "Ok name saved. Now give me a date.\nThe correct format is dd-mm-yyyy.");
  return EXAMPLE_CONVERSATION.ADD_START_DATE;
}

const addStartDate = function(bot, conversation_data, message) {
  var chat_id = conversation_data.chat_id;
  var startDate = message.text;
  var returnMsg = "Ok start date saved. Now give me a date again!\nThe correct format is dd-mm-yyyy.";
  var returnState = EXAMPLE_CONVERSATION.ADD_END_DATE;
  if(!dateRegex.test(startDate)) {
    returnMsg = "Please send a valid date using the correct format dd-mm-yyyy";
    returnState = EXAMPLE_CONVERSATION.ADD_START_DATE
  }
  bot.sendMessage(chat_id, returnMsg);
  return returnState;
}

const addEndDate = function(bot, conversation_data, message) {
  var chat_id = conversation_data.chat_id;
  var endDate = message.text;
  var returnMsg = "Perfect, end date saved!";
  var returnState = EXAMPLE_CONVERSATION.END;
  if(!dateRegex.test(endDate)) {
    returnMsg = "Please send a valid date using the correct format dd-mm-yyyy";
    returnState = EXAMPLE_CONVERSATION.ADD_END_DATE
  }
  bot.sendMessage(chat_id, returnMsg);
  return returnState;
}

const endConversation = function(bot, fullPayload, message) {
  var chat_id = message.chat.id;
  bot.sendMessage(chat_id, JSON.stringify(fullPayload, null, 2));
}