/**
 * Superclass to create db-like tables in Google Sheets.
 *
 * To use with a specific spreadsheet (e.g. from a web app where there is no
 * "active" spreadsheet), call GSTable.setSpreadsheet(id) once at startup.
 *
 * @example
 * class MyTable extends GSTable {
 *   constructor(name, age, city) {
 *     super();
 *     this.name = GSTable.COLUMN().STRING(name);
 *     this.age  = GSTable.COLUMN().NUMBER(age);
 *     this.city = GSTable.COLUMN().STRING(city);
 *   }
 * }
 */
class GSTable {

  // ─── Static spreadsheet override ──────────────────────────────────────────

  /**
   * Override the spreadsheet used by all GSTable subclasses.
   * Call this once at startup when running as a web app.
   * @param {string} spreadsheetId
   * @throws {Error} If the spreadsheet cannot be opened (wrong ID or missing permissions).
   */
  static setSpreadsheet(spreadsheetId) {
    try {
      GSTable._spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    } catch (e) {
      throw new Error(`[GSTable] Cannot open spreadsheet "${spreadsheetId}": ${e.message}`);
    }
  }

  /**
   * Returns the spreadsheet to use. Falls back to getActiveSpreadsheet().
   * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
   */
  static _getSpreadsheet() {
    return GSTable._spreadsheet || SpreadsheetApp.getActiveSpreadsheet();
  }

  // ─── Constructor ──────────────────────────────────────────────────────────

  /**
   * @param {string} id
   * @param {number} row_number      - Not a column; used internally to track the sheet row.
   * @param {Date}   created
   * @param {Date}   modified
   * @param {string} created_by
   * @param {string} last_modified_by
   */
  constructor(
    id               = "",
    row_number       = 0,
    created          = new Date(),
    modified         = new Date(),
    created_by       = "",
    last_modified_by = ""
  ) {
    this.id               = GSTable.COLUMN().STRING(id);
    this.row_number       = row_number;   // not a column – intentional
    this.created          = GSTable.COLUMN().DATE(created);
    this.modified         = GSTable.COLUMN().DATE(modified);
    this.created_by       = GSTable.COLUMN().STRING(created_by,       false);
    this.last_modified_by = GSTable.COLUMN().STRING(last_modified_by, false);
  }

  // ─── Column factory ───────────────────────────────────────────────────────

  /**
   * Factory for column definitions.
   *
   * FIX: NUMBER and BOOLEAN now use an explicit null/undefined check instead
   * of a truthy fallback. This ensures that 0 and false are preserved as
   * intentional values rather than being replaced by the default.
   *
   * @returns {{ DATE, TIME, STRING, NUMBER, BOOLEAN, FOREIGNKEY }}
   */
  static COLUMN() {

    function DATE(value, required = true) {
      return { _value: value != null ? value : "", _type: "date", _required: required };
    }

    function TIME(value, required = true) {
      return { _value: value != null ? value : "", _type: "time", _required: required };
    }

    function STRING(value, required = true) {
      return { _value: value != null ? value : "", _type: "str", _required: required };
    }

    /**
     * Explicit null/undefined check so that 0 is stored correctly and is not
     * confused with an absent value.
     */
    function NUMBER(value, required = true) {
      return { _value: value != null ? value : 0, _type: "number", _required: required };
    }

    /**
     * Explicit null/undefined check so that `false` is stored correctly and
     * is not replaced by the `false` default (which would make the intent
     * ambiguous).
     */
    function BOOLEAN(value, required = true) {
      return { _value: value != null ? value : false, _type: "bool", _required: required };
    }

    /**
     * @param {string}          value
     * @param {typeof GSTable}  referenceClass - The GSTable subclass this key points to.
     * @param {boolean}         required
     */
    function FOREIGNKEY(value, referenceClass, required = true) {
      return {
        _value:    value != null ? value : "",
        _type:     "fk",
        _required: required,
        _class:    referenceClass,
      };
    }

    return { DATE, TIME, STRING, NUMBER, BOOLEAN, FOREIGNKEY };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Returns true if the object looks like a column definition.
   * @param {Object} [propertyInfo={}]
   * @returns {boolean}
   */
  static isColumn(propertyInfo = {}) {
    const keys = Object.keys(propertyInfo);
    if (keys.length === 0) return false;
    return ["_value", "_type", "_required"].every(k => keys.includes(k));
  }

  /**
   * Generates a random alphanumeric ID.
   * @param {number} length - Must be > 0.
   * @returns {string}
   */
  static generateId(length) {
    if (length <= 0) throw new Error("Length must be greater than 0");

    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  // ─── Sheet management ─────────────────────────────────────────────────────

  /**
   * Ensures the sheet exists and its headers match the class definition.
   * New columns are appended; removed columns are deleted in reverse index
   * order (so earlier indices are not shifted before deletion).
   *
   * PERF: Results are cached in GSTable._headerCache for the lifetime of the
   * current script execution. The cache entry is populated only when the
   * in-memory schema matches the sheet headers exactly (i.e. no structural
   * change was needed). On structural changes the sheet is always updated and
   * the cache is refreshed.
   *
   * @returns {{ sheet: GoogleAppsScript.Spreadsheet.Sheet, headers: string[] }}
   */
  static getTableInfo() {
    const emptyObj    = new this();
    const class_props = Object.getOwnPropertyNames(emptyObj)
                              .filter(p => this.isColumn(emptyObj[p]));
    const sheet_name  = emptyObj.constructor.name;

    // ── Cache hit: schema unchanged, avoid a sheet read ──────────────────────
    const cached = GSTable._headerCache[sheet_name];
    if (
      cached &&
      cached.headers.length === class_props.length &&
      class_props.every((p, i) => cached.headers[i] === p)
    ) {
      return cached;
    }

    // ── Cache miss: sync schema with the sheet ────────────────────────────────
    const ss    = this._getSpreadsheet();
    let   sheet = ss.getSheetByName(sheet_name);
    let   headers;

    if (sheet === null) {
      sheet   = ss.insertSheet(sheet_name);
      sheet.appendRow(class_props);
      headers = [...class_props];
      SpreadsheetApp.flush();
    } else {
      headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

      const new_props        = class_props.filter(p => !headers.includes(p));
      const columns_to_delete = headers.filter(h => !class_props.includes(h));
      const needsWrite       = new_props.length > 0 || columns_to_delete.length > 0;

      if (new_props.length > 0) {
        sheet.getRange(1, sheet.getLastColumn() + 1, 1, new_props.length)
             .setValues([new_props]);
      }

      if (columns_to_delete.length > 0) {
        // Delete in descending index order so earlier indices remain stable.
        columns_to_delete
          .map(col => headers.indexOf(col) + 1) // 1-based
          .sort((a, b) => b - a)                // descending
          .forEach(idx => sheet.deleteColumn(idx));
      }

      // Reflect the updated header list in memory
      headers = [...headers.filter(h => !columns_to_delete.includes(h)), ...new_props];

      if (needsWrite) SpreadsheetApp.flush();
    }

    const result = { sheet, headers };
    GSTable._headerCache[sheet_name] = result;
    return result;
  }

  // ─── Data conversion ──────────────────────────────────────────────────────

  /**
   * Converts a raw 2-D array (first row = headers) into an array of plain objects.
   *
   * FIX: The original implementation mutated the input array via `.shift()`.
   * This version uses destructuring so the caller's array is left untouched.
   *
   * @param {any[][]} [rawData=[]]
   * @returns {Object[]}
   */
  static fromRawDataToArrayOfObject(rawData = []) {
    const [headers, ...rows] = rawData;
    if (!headers) return [];

    return rows.map((row, rowIndex) => {
      const data = { row_number: rowIndex + 2 }; // +2: header row + 0-based index
      row.forEach((cell, colIndex) => {
        data[headers[colIndex]] = cell;
      });
      return data;
    });
  }

  /**
   * Maps a plain object (from the sheet) to a typed GSTable instance.
   * @param {Object} rawObject
   * @returns {InstanceType<this>}
   */
  static fromJson(rawObject) {
    const obj        = new this();
    const properties = Object.getOwnPropertyNames(obj);

    properties.forEach(prop => {
      if (this.isColumn(obj[prop])) {
        obj[prop]._value = rawObject[prop];
      } else {
        obj[prop] = rawObject[prop];
      }
    });

    return obj;
  }

  // ─── Query API ────────────────────────────────────────────────────────────

  /**
   * Returns all rows as typed instances.
   * @returns {InstanceType<this>[]}
   */
  static findAll() {
    const { sheet } = this.getTableInfo();
    const rawArray  = this.fromRawDataToArrayOfObject(sheet.getDataRange().getValues());
    return rawArray.map(raw => this.fromJson(raw));
  }

  /**
   * Finds the first entity whose `id` matches.
   * @param {string} id
   * @returns {InstanceType<this> | undefined}
   */
  static findById(id) {
    return this.findAll().find(entity => entity.id._value === id);
  }

  /**
   * Filters entities using predicate functions.
   *
   * FIX: An empty `conditions` object now returns all records (via findAll)
   * instead of an empty array. "No filters" logically means "everything".
   *
   * @param {Object.<string, function>} conditions
   *   Keys are property names; values are predicate functions that receive
   *   the raw property object (with `_value`) and return a boolean.
   * @returns {InstanceType<this>[]}
   *
   * @example
   * Conversation.filterByConditions({
   *   chat_id: v => v._value == chatId,
   *   date:    v => Date.now() - new Date(v._value).getTime() < 900_000
   * });
   */
  static filterByConditions(conditions) {
    const conditionKeys = Object.keys(conditions);
    if (conditionKeys.length === 0) return this.findAll();

    return this.findAll().filter(entity =>
      conditionKeys.every(key => {
        if (typeof conditions[key] !== "function") return true;
        return conditions[key](entity[key]);
      })
    );
  }

  // ─── Instance API ─────────────────────────────────────────────────────────

  /** @param {string} key @param {any} value */
  setValue(key, value) {
    this[key]._value = value;
  }

  /** @param {string} key @returns {any} */
  getValue(key) {
    return this[key]._value;
  }

  /**
   * Returns the ordered array of values matching the current sheet headers,
   * ready to be written to the spreadsheet.
   * @returns {any[]}
   */
  getUpdateArray() {
    const { headers } = this.constructor.getTableInfo();
    return headers.map(header => {
      const prop = this[header];
      return this.constructor.isColumn(prop) ? prop._value : undefined;
    });
  }

  /**
   * Returns the header names that are marked required but have no value.
   * @param {string[]} headers
   * @param {any[]}    updateArray
   * @returns {string[]}
   */
  checkRequired(headers, updateArray) {
    return headers.filter((header, i) => {
      const prop = this[header];
      return prop && prop._required && (updateArray[i] === undefined || updateArray[i] === "");
    });
  }

  /**
   * Persists the entity to the sheet (insert if new, update if existing).
   *
   * FIX: The active-user check now tests the email string rather than the
   * user object reference. In web apps deployed as "execute as: me",
   * getActiveUser() always returns a non-null object but getEmail() returns
   * an empty string — the original `!== null` check would have written an
   * empty string to last_modified_by on every call.
   *
   * @throws {Error} If any required column is empty.
   */
  persist() {
    const { sheet, headers } = this.constructor.getTableInfo();

    this.modified._value = new Date();

    const email = Session.getActiveUser().getEmail();
    if (email) this.last_modified_by._value = email;

    const updateArray = this.getUpdateArray();

    if (this.id._value === "") {
      // ── INSERT ──
      const newProps = {
        id:         this.constructor.generateId(8),
        created:    this.modified._value,
        created_by: this.last_modified_by._value,
      };

      Object.entries(newProps).forEach(([prop, val]) => {
        const pos         = headers.indexOf(prop);
        updateArray[pos]  = val;
        this[prop]._value = val;
      });

      const wrongs = this.checkRequired(headers, updateArray);
      if (wrongs.length > 0) {
        throw new Error(`'${wrongs.join("', '")}' are marked as 'required'`);
      }

      sheet.appendRow(updateArray);
      this.row_number = sheet.getLastRow();

    } else if (this.row_number > 0) {
      // ── UPDATE ──
      const wrongs = this.checkRequired(headers, updateArray);
      if (wrongs.length > 0) {
        throw new Error(`'${wrongs.join("', '")}' are marked as 'required'`);
      }

      sheet.getRange(this.row_number, 1, 1, updateArray.length)
           .setValues([updateArray]);
    }

    SpreadsheetApp.flush();
  }

  /**
   * Deletes this entity's row from the sheet.
   */
  remove() {
    if (this.row_number === 0) return;

    const { sheet } = this.constructor.getTableInfo();
    sheet.deleteRow(this.row_number);
    this.row_number = 0;

    SpreadsheetApp.flush();
  }

  /**
   * Loads related entities for all FOREIGNKEY columns and attaches them as
   * `<propertyName>_` on this instance.
   */
  expand() {
    Object.getOwnPropertyNames(this).forEach(prop => {
      const info = this[prop];
      if (this.constructor.isColumn(info) && info.hasOwnProperty("_class")) {
        this[prop + "_"] = info._class.findById(info._value);
      }
    });
  }

  // ─── Serialization ────────────────────────────────────────────────────────

  /**
   * Converts the entity to a plain object.
   * Override `objectExtension` in subclasses to add computed properties.
   * @param {Object|null} [extendWith=null]
   * @returns {Object}
   */
  toSimpleObject(extendWith = null) {
    const plainObj   = {};
    const properties = Object.getOwnPropertyNames(this);

    properties.forEach(prop => {
      const info = this[prop];
      if (this.constructor.isColumn(info)) {
        plainObj[prop] = info._value;
      } else if (info instanceof GSTable) {
        plainObj[prop] = info.toSimpleObject();
      }
    });

    return this.objectExtension(plainObj, extendWith);
  }

  /**
   * Override in subclasses to add custom properties to `toSimpleObject()`.
   * @param {Object} simpleObject
   * @param {any}    extendWith
   * @returns {Object}
   */
  objectExtension(simpleObject, extendWith = null) {
    return simpleObject;
  }

  /** @returns {string} Pretty-printed JSON of the entity. */
  toString() {
    return JSON.stringify(this.toSimpleObject(), null, 2);
  }

  /** Logs the JSON representation to the Apps Script logger. */
  print() {
    Logger.log(this.toString());
  }
}

// ---------------------------------------------------------------------------
// Static property initialisation
// (class field declarations — `static prop = value` — are not supported by
// the Google Apps Script parser even with the V8 runtime, so these must be
// assigned outside the class body.)
// ---------------------------------------------------------------------------

/**
 * In-memory header cache keyed by sheet/class name.
 * Populated by getTableInfo(); invalidated automatically when the schema
 * changes (columns added or removed).
 * The cache is scoped to a single script execution — it is always empty at
 * the start of a new invocation.
 * @type {Object.<string, { sheet: GoogleAppsScript.Spreadsheet.Sheet, headers: string[] }>}
 */
GSTable._headerCache = {};