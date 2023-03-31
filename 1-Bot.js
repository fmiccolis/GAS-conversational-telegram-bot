class TelegramBot {
  constructor(token, webAppId, spreadsheetId, devList) {
    this.token = token;
    this.telegramUrl = "https://api.telegram.org/bot" + token;
    this.fileTelegramUrl = "https://api.telegram.org/file/bot" + token;
    this.webAppUrl = "https://script.google.com/macros/s/" + webAppId + "/exec";
    this.devList = devList.split(",");
    this.handlers = {}
    UrlFetchApp.fetch(this.telegramUrl + "/setWebhook?url=" + this.webAppUrl);

    this.spreadsheetId = spreadsheetId;
    this.spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    this.received = null;
    this.sent = null;
    this.conversation = null;
    this.init();
  }

  init() {
    this.received = this.spreadsheet.getSheetByName("received") || this.createReceivedSheet();
    this.sent = this.spreadsheet.getSheetByName("sent") || this.createSentSheet();
    this.conversation = this.spreadsheet.getSheetByName("conversations") || this.createConversationSheet();
  }

  createReceivedSheet() {
    var received_sheet = this.spreadsheet.insertSheet("received");
    received_sheet.appendRow(["date", "chat_id", "user_id", "content"]);
    return received_sheet;
  }

  createSentSheet() {
    var sent_sheet = this.spreadsheet.insertSheet("sent");
    sent_sheet.appendRow(["date", "chat_id", "message_id", "content"]);
    return sent_sheet;
  }

  createConversationSheet() {
    var conversation_sheet = this.spreadsheet.insertSheet("conversations");
    conversation_sheet.appendRow(["date", "chat_id", "user_id", "payload"]);
  }

  logReceived(row) {
    this.received.appendRow(row);
  }

  logSent(row) {
    this.sent.appendRow(row);
  }

  logConversation(row) {
    this.conversation.appendRow(row);
  }

  getValuesBySheet(sheet) {
    var table = sheet.getDataRange().getValues();
    var headers = table.shift();
    var result = []
    table.forEach((row, row_id) => {
      // add 2 because of the headers and arrays starts from 0
      var data = {
        row_id: row_id+2
      }
      row.forEach((cell, index) => {
        data[headers[index]] = cell
      })
      result.push(data)
    })
    return result;
  }

  getReceivedMessages() {
    return this.getValuesBySheet(this.received);
  }

  getSentMessages() {
    return this.getValuesBySheet(this.sent);
  }

  getConversationMessages() {
    return this.getValuesBySheet(this.conversation);
  }

  resetSheet(sheet) {
    var last_row = sheet.getLastRow();
    if(last_row !== 1) {
      sheet.deleteRows(2, last_row-1);
      this.sendMessageToDevs("Deleted " + (last_row-1) + " rows from '" + sheet.getName() + "' sheet")
    }
  }

  resetReceivedSheet() {
    this.resetSheet(this.received);
  }

  resetSentSheet() {
    this.resetSheet(this.sent);
  }

  resetConversationSheet() {
    this.resetSheet(this.conversation);
  }

  expireConversation() {
    var conversation_data = this.getConversationMessages();
    var timestamp = new Date().getTime();
    var conversation_to_delete = conversation_data.filter(conversation => timestamp > conversation.date + 901000)
    conversation_to_delete.sort((a, b) => a.row_id > b.row_id ? -1 : 1);
    if(conversation_to_delete.length === 0) return;

    conversation_to_delete.forEach(conversation => {
      this.conversation.deleteRow(conversation.row_id);
    })
    this.sendMessageToDevs("Deleted " + conversation_to_delete.length + " conversations");
  }

  addHandler(command, description, type, callback) {
    this.handlers[command] = {
      description: description,
      callback: callback,
      type: type
    };
  }

  dispatcher(request) {
    var message = request.message;
    var text = message.text;
    var entities = message.entities;
    var command = "";
    var params = "";

    if(entities) {
      entities.every(({offset, length, type}) => {
        if(type === "bot_command") {
          command = text.substr(offset, length).split("@")[0];
          params = text.substr(offset+length+1)
          return false;
        }
      });
    }
    
    try {
      this.main(message, command, params);
    } catch(error) {
      var composed_error_message = "Error:\n\n" + error + "\n\n" + JSON.stringify(request, null, 2);
      Logger.log(composed_error_message);
      this.sendMessageToDevs(composed_error_message);
    }
  }

  main(message, command, params) {
    var conversation_data = this.defaultHandler(params, message);
    if(conversation_data) {
      var payload = JSON.parse(conversation_data.payload)
      var command_name = payload.name;
      var handler_object = this.handlers[command_name].callback;
      if(command === handler_object.fallback.command) {
        handler_object.fallback.handler(this, conversation_data, message);
        return;
      }
      var first_not_completed = payload.data.findIndex(state => !state.completed);
      if(first_not_completed !== -1) {
        var progress = handler_object.states[first_not_completed].handler(this, conversation_data, message);
        var updatedPayload = {}
        if(progress > first_not_completed) updatedPayload = this.updateConversation(conversation_data, message, progress-1);
        if(progress === payload.data.length) handler_object.final(this, updatedPayload, message);
        return;
      }
    }

    var command_object = this.handlers[command];
    if(command_object) {
      var handler_object = command_object.callback;
      if(handler_object.entry) {
        var payload = this.generateInitialPayload(command);
        this.startConversation(message, payload);
        handler_object.entry(this, params, message)
        return;
      }
      handler_object(this, params, message)
    }
  }

  defaultHandler(params, message) {
    var copy_message = {...message}
    delete copy_message["from"];
    delete copy_message["chat"];
    delete copy_message["date"];
    this.logReceived([message.date, JSON.stringify(message.chat, null, 2), JSON.stringify(message.from, null, 2), JSON.stringify(copy_message, null, 2)]);

    // do something when there are photos, videos or documents
    //if(message.photo) this.savePhotoOnDrive(message);
    //if(message.video) this.saveVideoOnDrive(message);
    //if(message.document) this.saveDocumentOnDrive(message);

    return this.isInConversation(message)
  }

  isInConversation(message) {
    var conversation_data = this.getConversationMessages();
    if(conversation_data.length == 0) return null;

    var chat_id = message.chat.id;
    var user_id = message.from.id;
    var this_message_conversation = conversation_data.filter(line => line.chat_id == chat_id && line.user_id == user_id)
    if(this_message_conversation.length == 0) return null;

    var [last] = this_message_conversation.slice(-1);
    if(new Date().getTime() > last.data + 900000) return null;

    return last;
  }

  generateInitialPayload(starting_command) {
    var payload = {name: starting_command}

    var command_data = this.handlers[starting_command];
    var states = command_data.callback.states;
    payload.data = states.map(state => ({type: state.type, value: null, completed: false}));
    return payload;
  }

  startConversation(message, payload) {
    var chat_id = message.chat.id;
    var user_id = message.from.id;
    var data = new Date().getTime();
    this.logConversation([data, chat_id, user_id, JSON.stringify(payload, null, 2)]);
  }

  updateConversation(conversation_data, message, position) {
    var all_values = this.conversation.getDataRange().getValues();
    var headers = all_values[0];

    var date_index = headers.indexOf("date") + 1;
    var payload_index = headers.indexOf("payload") + 1;

    var row_id = conversation_data.row_id;
    var payload = JSON.parse(conversation_data.payload);
    payload.data[position].value = message.text;
    payload.data[position].completed = true;

    this.conversation.getRange(row_id, date_index).setValue(new Date().getTime())
    this.conversation.getRange(row_id, payload_index).setValue(JSON.stringify(payload, null, 2))
    return payload;
  }

  deleteConversation(conversation) {
    this.conversation.deleteRow(conversation.row_id);
  }

  /**
   * Sends a message to the specified chat.
   * @param {number|string} id - Chat ID.
   * @param {string} text - Text of the message to be sent.
   * @returns {Object} Result of the sendMessage API call.
   */
  sendMessage(id, text) {
    var data = {
      method: "post",
      payload: {
        method: "sendMessage",
        chat_id: String(id),
        text: text,
        parse_mode: "HTML",
      }
    };
    var {result} = JSON.parse(UrlFetchApp.fetch(this.telegramUrl + '/', data).getContentText());
    var chat_id = result.chat.id;
    var message_id = result.message_id
    var copy_message = {...result};
    delete copy_message["from"];
    delete copy_message["chat"];
    delete copy_message["date"];
    this.logSent([new Date(), chat_id, message_id, JSON.stringify(copy_message, null, 2)])
    return result;
  }

  /**
   * Sends a message to all developer chat IDs.
   * @param {string} text - Text of the message to be sent.
   */
  sendMessageToDevs(text) {
    this.devList.forEach(dev_id => this.sendMessage(dev_id, text))
  }

  /**
   * Gets a file object for the specified file ID.
   * @param {string} file_id - File ID.
   * @returns {HTTPResponse} File object for the specified file ID.
   */
  getFile(file_id) {
    return UrlFetchApp.fetch(this.telegramUrl + '/getFile?file_id=' + file_id)
  }

  /**
   * Downloads a file from Telegram file API.
   * @param {string} path - Path to the file.
   * @returns {HTTPResponse} File data.
   */
  downloadFile(path) {
    return UrlFetchApp.fetch(this.fileTelegramUrl + '/' + path)
  }
  
  /**
   * Deletes a message from a chat with a specific message_id
   * @param {string} chat_id - The ID of the chat where the message is to be deleted
   * @param {string} message_id - The ID of the message to be deleted
   */
  deleteMessage(chat_id, message_id) {
	  UrlFetchApp.fetch(this.telegramUrl + "/deleteMessage?chat_id=" + chat_id + "&message_id=" + message_id);
  }
}