const SETTINGS_SHEET_NAME = 'Settings';
const PACKAGE_MAPPINGS_SHEET_NAME = 'Package mappings';
const FIELD_MAPPINGS_SHEET_NAME = 'Field mappings';
const GENDER_MAPPINGS_SHEET_NAME = 'Gender mappings';

const SETTINGS_VALUE_COLUMN = 2;

const FIELD_MAPPINGS_FORM_COLUMN = 1;
const FIELD_MAPPINGS_API_COLUMN = 2;

const PACKAGE_MAPPINGS_FORM_COLUMN = 1;
const PACKAGE_MAPPINGS_API_COLUMN = 2;

const GENDER_MAPPINGS_FORM_COLUMN = 1;
const GENDER_MAPPINGS_API_COLUMN = 2;

function get_form_data_sheet() {
    const spreadsheet = SpreadsheetApp.getActive();
    for (const sheet of spreadsheet.getSheets()) {
        if (is_form_data_sheet(sheet)) {
            return sheet;
        }
    }
    return null;
}

function is_form_data_sheet(sheet) {
    return !!sheet.getFormUrl();
}

function get_form() {
    const form_sheet = get_form_data_sheet();
    const form_url = form_sheet.getFormUrl();
    if (!form_url) {
        throw new Error('This Google Sheet does not appear to be bound to a Google Form');
    }

    let retries = 0;
    while (true) {
        try {
            return FormApp.openByUrl(form_url);
        } catch (e) {
            retries += 1;
            if (retries > 3) {
                throw e;
            }
            Utilities.sleep(2 * 1000);
        }
    }
}

function get_sheet(name, create_function, optional) {
    const spreadsheet = SpreadsheetApp.getActive();
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet && create_function) {
        create_function(name);
        sheet = spreadsheet.getSheetByName(name);
    }
    if (!sheet && !optional) {
        throw new Error(`Couldn’t find the "${name}" sheet`);
    }
    return sheet;
}

const SETTINGS = {
    api_key: 'API Key'
};

function get_api_key_range() {
    const sheet = get_sheet(SETTINGS_SHEET_NAME);
    const last_row = sheet.getLastRow();
    const first_row = 2;
    const settings = sheet.getRange(first_row, 1, last_row - 1, 2).getValues();
    let row = first_row;
    for (const setting of settings) {
        if (setting[0] == SETTINGS.api_key) {
            return sheet.getRange(row, 2, 1, 1);
        }
        row += 1;
    }
    throw new Error('Couldn’t find the API key setting!');
}

function get_api_key() {
    const key_range = get_api_key_range();
    return key_range.getValue();
}

function set_api_key(api_key) {
    const key_range = get_api_key_range();
    key_range.setValue(api_key);
    const sheet = get_sheet(SETTINGS_SHEET_NAME);
    sheet.autoResizeColumn(SETTINGS_VALUE_COLUMN);
}

function get_or_ask_for_api_key() {
    let api_key = get_api_key();
    Logger.log(`API Key: ${api_key}`);

    const base_message = 'Please copy & paste a Fabman API Key token for your Fabman account. For more information on how to create API keys, go to https://help.fabman.io/article/80-api-key';
    let message = base_message;
    while (!api_key) {
        Logger.log(`Asking for API key: ${api_key}`);
        const ui = SpreadsheetApp.getUi();
        const response = ui.prompt('Enter API Key', message, ui.ButtonSet.OK_CANCEL);

        // Process the user's response.
        if (response.getSelectedButton() == ui.Button.OK) {
            api_key = response.getResponseText();
            try {
                const me = fetch_me(api_key);
                Logger.log(me);
                set_api_key(api_key);
                break;
            } catch (e) {
                message = 'The API key appears to be invalid. ' + base_message;
                api_key = '';
            }
        } else {
            break;
        }
    }

    return api_key;
}

const PACKAGE_ID_EXPRESSION = /\(ID:\s*(\d+)\)$/;

function get_configured_packages() {
    const sheet = get_sheet(PACKAGE_MAPPINGS_SHEET_NAME);

    const first_package = 2;
    const package_settings = sheet.getRange(first_package, 1, sheet.getLastRow() - first_package + 1, 2).getValues();
    const packages = new Map();
    let row = first_package;
    for (const setting of package_settings) {
        Logger.log(`Package "${setting[0]}": "${setting[1]}"`);
        const form_name = setting[0];
        const api_name = setting[1];
        let api_id = null;
        if (api_name) {
            const match = api_name.match(PACKAGE_ID_EXPRESSION);
            if (match) {
                api_id = match[1];
            }
        }
        packages.set(form_name, {
            id: api_id,
            row,
        });
        row += 1;
    }
    if (!packages.size) {
        throw new Error(`You need to define your packages in the "${PACKAGE_MAPPINGS_SHEET_NAME}" sheet!`);
    }
    return packages;
}

function get_configured_genders() {
    const genders = new Map();

    const sheet = get_sheet(GENDER_MAPPINGS_SHEET_NAME, null, true);
    if (!sheet) return genders;

    const first_gender = 2;
    const gender_settings = sheet.getRange(first_gender, 1, sheet.getLastRow() - first_gender + 1, 2).getValues();
    let row = first_gender;
    for (const setting of gender_settings) {
        Logger.log(`Gender "${setting[0]}": "${setting[1]}"`);
        const form_name = setting[0];
        const api_name = setting[1];
        genders.set(form_name, {
            id: api_name,
            row,
        });
        row += 1;
    }

    return genders;
}

function get_field_map() {
    const sheet = get_sheet(FIELD_MAPPINGS_SHEET_NAME);
    const first_mappings_row = 2;
    const mapping = new Map();
    const value_range = sheet.getRange(first_mappings_row, FIELD_MAPPINGS_FORM_COLUMN, sheet.getLastRow() - first_mappings_row + 1, FIELD_MAPPINGS_API_COLUMN - FIELD_MAPPINGS_FORM_COLUMN + 1);
    const values = value_range.getValues();
    values.forEach((row, i) => {
        const form_field_name = row[0];
        const api_field_name = row[row.length - 1];
        const api_field_details = API_FIELDS[api_field_name];
        mapping.set(form_field_name, {
            name: api_field_name,
            details: api_field_details,
            row: first_mappings_row + i,
        });
    });
    return mapping;
}

const API_FIELDS = {
    // @ToDo: Maybe add support for mapping the space name. :MultipleSpaces
    'ignore': null,
    'Intial package': {package: 'name'},
    'Intial package start date': {package: 'fromDate', date: true},
    'First name': {member: 'firstName'},
    'Last name': {member: 'lastName'},
    'Email address': {member: 'emailAddress'},
    'Member number': {member: 'firstName'},
    'Phone': {member: 'phone'},
    'Date of birth': {member: 'dateOfBirth', date: true},
    'Gender': {member: 'gender'},
    'Company': {member: 'company'},
    'Notes': {member: 'notes', rich_text: true},
    'Address line 1': {member: 'address'},
    'Address line 2': {member: 'address2'},
    'City': {member: 'city'},
    'Zip / Postal code': {member: 'zip'},
    'Country code': {member: 'countryCode'},
    'Region / State': {member: 'region'},
    'Has separate billing address (yes/no)': {member: 'hasBillingAddress'},
    'Billing address: First name': {member: 'billingFirstName'},
    'Billing address: Last name': {member: 'billingLastName'},
    'Billing address: Company': {member: 'billingCompany'},
    'Billing address line 1': {member: 'billingAddress'},
    'Billing address line 2': {member: 'billingAddress2'},
    'Billing address: City': {member: 'billingCity'},
    'Billing address: Zip / Postal code': {member: 'billingZip'},
    'Billing address: Country code': {member: 'billingCountryCode'},
    'Billing address: Region / State': {member: 'billingRegion'},
};


function fetch_me(api_key) {
    return fetch(api_key, '/user/me');
}

function fetch_packages(api_key) {
    return fetch_all(api_key, '/packages');
}

function fetch(api_key, url) {
    const response = try_send_request(api_key, 'GET', url);
    if (response.getResponseCode() > 299) {
        return handle_request_error(response);
    }
    const data = JSON.parse(response.getContentText());
    return data;
}

function fetch_all(api_key, url) {
    let separator = url.indexOf('?') === -1 ? '?' : '&';
    let limit = 1000;
    let results = [];
    while (true) {
        const offset = results.length;
        const page_url = `${url}${separator}limit=${limit}&offset=${offset}`;
        const response = try_send_request(api_key, 'GET', page_url);
        if (response.getResponseCode() > 299) {
            return handle_request_error(response);
        }
        const data = JSON.parse(response.getContentText());
        results.push(...data);

        let total_count = 0;
        const headers = response.getHeaders();
        // Google doesn’t normalize header case, so we have to do a stupid search:
        for (const name of Object.keys(headers)) {
            if (name.toLowerCase() == 'x-total-count') {
                total_count = parseInt(headers[name], 10);
                break;
            }
        }

        if (results.length >= total_count) break;
    }
    return results;
}

function send_request(api_key, method, path, payload) {
    const response = try_send_request(api_key, method, path, payload);
    if (response.getResponseCode() > 299) {
        return handle_request_error(response);
    }
    const data = JSON.parse(response.getContentText());
    return data;
}

function try_send_request(api_key, method, url, payload) {
    const full_url = `https://fabman.io/api/v1${url}`;
    Logger.log(`Request: ${method} ${full_url}`);
    const request = {
        method: method.toLowerCase(),
        muteHttpExceptions: true,
        headers: {
            Authorization: `Bearer ${api_key}`,
        },
    };
    if (payload) {
        request.payload = JSON.stringify(payload);
        Logger.log(`Payload: ${request.payload}`);
        request.headers['Content-Type'] = 'application/json';
    }

    const response = UrlFetchApp.fetch(full_url, request);
    response.request_method = method;
    response.request_url = full_url;
    return response;
}

function handle_request_error(response) {
    // @ToDO: Unauth error handling, etc.?
    Logger.log(`Unexpected response code for "${response.request_method} ${response.request_url}": ${response.getResponseCode()}`);
    const body = response.getContentText();
    Logger.log(body);
    let message = `Couldn’t ${response.request_method} ${response.request_url}`;
    if (response.getResponseCode() == 400) {
        const parsed = JSON.parse(body);
        message += `: ${parsed.message}`;
    }

    throw new Error(message);
}

function is_error(response, code, tag) {
    if (response.getResponseCode() != code) return false;

    const data = JSON.parse(response.getContentText());
    return data.data && data.data[tag];
}
