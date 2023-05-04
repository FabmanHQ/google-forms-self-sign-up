const MENU_ITEM_UPDATE_FROM_FORM_TITLE = 'Update data from Google Forms';
const MENU_ITEM_UPDATE_FROM_FABMAN_TITLE = 'Update data from Fabman';

function onInstall(e) {
    Logger.log(`On install: ${JSON.stringify(e)}`);
    onOpen(e);
    run_install();
}

function run_install() {
    Logger.log('run_install');
    const form_sheet = get_form_data_sheet();
    if (!form_sheet) {
        const message = 'This plugin is intended for Google Sheets that are linked to a Google Forms document. Please set up a Google Forms document, set its response destination to a Google Sheets document, and try this plugin on that Google Sheets document.';
        const ui = SpreadsheetApp.getUi();
        ui.alert('No Google Forms document found', message, ui.ButtonSet.OK);
        return;
    }

    update_menu();
    install_form_submit_trigger();
    install_edit_trigger();

    get_sheet(SETTINGS_SHEET_NAME, create_settings_sheet);
    const field_mappings_sheet = get_sheet(FIELD_MAPPINGS_SHEET_NAME, create_field_mappings_sheet);
    get_sheet(PACKAGE_MAPPINGS_SHEET_NAME, create_package_mappings_sheet);

    field_mappings_sheet.activate();
    update_field_mappings_sheet();

    const api_key = get_or_ask_for_api_key();
    if (api_key && !validate_api_key(get_api_key_range())) {
        return;
    }
    // @ToDo: Check if there’s only one space?

    update_package_mappings_sheet();
}

function onOpen(e) {
    Logger.log(`On open: ${JSON.stringify(e)}`);
    update_menu(e);
}

function update_menu(e) {
    const menu = SpreadsheetApp.getUi()
        .createMenu('Fabman');
    if ((e && e.authMode == ScriptApp.AuthMode.NONE) || get_sheet(FIELD_MAPPINGS_SHEET_NAME, create_field_mappings_sheet) == null) {
        menu.addItem('Set up this form', 'run_install')
            .addToUi();
    } else {
        menu.addItem('Validate settings', 'validate_settings')
            .addItem(`${MENU_ITEM_UPDATE_FROM_FORM_TITLE} (if form fields have changed)`, 'update_from_form')
            .addItem(`${MENU_ITEM_UPDATE_FROM_FABMAN_TITLE} (if you have added/removed Fabman packages)`, 'update_from_fabman')
            .addItem('Set up this form again', 'run_install')
            .addToUi();
    }
}

function update_from_form() {
    get_or_ask_for_api_key();
    update_field_mappings_sheet();
    update_package_mappings_sheet();
}

function update_from_fabman() {
    get_or_ask_for_api_key();
    update_package_mappings_sheet();
}

function on_installed_edit(e) {
    Logger.log(`On installed edit: ${JSON.stringify(e)}`);
    const range = e.range;

    const sheet = range.getSheet();
    if (is_form_data_sheet(sheet)) {
        // Update the mapping settings if this edit affected the form columns
        if (range.getRowIndex() != 1) return;
        update_field_mappings_sheet();
    } else if (sheet.getName() == SETTINGS_SHEET_NAME) {
        const api_key_range = get_api_key_range();
        // @Cleanup: There’s no "Range.contains()" !?!?
        if (range.getRow() <= api_key_range.getRow() && range.getLastRow() >= api_key_range.getRow() &&
            range.getColumn() <= api_key_range.getColumn() && range.getLastColumn() >= api_key_range.getColumn()) {

            on_api_key_changed(api_key_range);
        }

    } else if (sheet.getName() == FIELD_MAPPINGS_SHEET_NAME) {

        if (range.getColumn() > FIELD_MAPPINGS_API_COLUMN || range.getLastColumn() < FIELD_MAPPINGS_API_COLUMN) return;

        // Check if they modified a value and mapped it to "package name":
        const rows = sheet.getRange(range.getRow(), FIELD_MAPPINGS_API_COLUMN, range.getNumRows(), 1).getValues();
        for (const row of rows) {
            const api_field_name = rows[0];
            const api_field_details = API_FIELDS[api_field_name];
            if (api_field_details && api_field_details.package) {
                update_package_mappings_sheet(true);
            }
        }
    }
}

function on_api_key_changed(api_key_range) {
    if (!validate_api_key(api_key_range)) return;

    update_package_mappings_sheet();
}

function validate_api_key(api_key_range) {
    const api_key = api_key_range.getValue();
    api_key_range.setBackgroundColor(null);
    if (api_key) {
        try {
            fetch_me(api_key_range.getValue());
            // @ToDo: Make sure the account has only one space
        } catch (e) {
            const ui = SpreadsheetApp.getUi();
            ui.alert('Invalid API Key', 'The API key appears to be invalid.', ui.ButtonSet.OK);
            api_key_range.setBackgroundColor('red');
            api_key_range.activate();
            return false;
        }
    }
    return true;
}

function install_form_submit_trigger() {
    const spreadsheet = SpreadsheetApp.getActive();
    const triggers = ScriptApp.getUserTriggers(spreadsheet);

    const handler_name = on_form_submitted.name;
    for (const trigger of triggers) {
        if (trigger.getHandlerFunction() == handler_name) {
            return;
        }
    }

    Logger.log('Installing form submit handler');
    ScriptApp.newTrigger(handler_name)
        .forSpreadsheet(spreadsheet)
        .onFormSubmit()
        .create();
}

// We have to use an installed OnEdit trigger instead of the simple onEdit handler
// because the latter runs in LIMITED mode and therefore does not have permission to access the Google Forms document.
function install_edit_trigger() {
    const spreadsheet = SpreadsheetApp.getActive();
    const triggers = ScriptApp.getUserTriggers(spreadsheet);

    const handler_name = on_installed_edit.name;
    for (const trigger of triggers) {
        if (trigger.getHandlerFunction() == handler_name) {
            return;
        }
    }

    Logger.log('Installing edit handler');
    ScriptApp.newTrigger(handler_name)
        .forSpreadsheet(spreadsheet)
        .onEdit()
        .create();
}

function create_settings_sheet(name) {
    const spreadsheet = SpreadsheetApp.getActive();
    const sheet = spreadsheet.insertSheet(name, spreadsheet.getNumSheets());
    {
        const range = sheet.getRange(1, 1, 1, 1);
        range.setValue('Setting');
        range.setFontWeight('bold');
    }
    {
        const range = sheet.getRange(1, SETTINGS_VALUE_COLUMN, 1, 1);
        range.setValue('Value');
        range.setFontWeight('bold');
    }
    {
        const range = sheet.getRange(2, 1, 1, 1);
        range.setValue(SETTINGS.api_key);
    }
    {
        const range = sheet.getRange(2, SETTINGS_VALUE_COLUMN, 1, 1);
        range.setNote('Please sign in to your Fabman account, create an API key, and paste the access token into this cell. For more information on how to create API keys, go to https://help.fabman.io/article/80-api-key');
    }

    sheet.autoResizeColumn(1);

    // Prevent the name column from being edited
    const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    protections.forEach(p => p.remove());

    const protection = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).protect();
    protection.setDescription('Please only edit the setting values');
    protection.setWarningOnly(true);
}

function create_field_mappings_sheet(name) {
    const spreadsheet = SpreadsheetApp.getActive();
    const sheet = spreadsheet.insertSheet(name);
    {
        const range = sheet.getRange(1, FIELD_MAPPINGS_FORM_COLUMN, 1, 1);
        range.setValue('Form field name');
        range.setFontWeight('bold');
    }
    {
        const range = sheet.getRange(1, FIELD_MAPPINGS_API_COLUMN, 1, 1);
        range.setValue('Fabman member field');
        range.setFontWeight('bold');
    }

    sheet.autoResizeColumn(1);
    sheet.autoResizeColumn(2);
}

function create_package_mappings_sheet(name) {
    const spreadsheet = SpreadsheetApp.getActive();
    const sheet = spreadsheet.insertSheet(name);
    {
        const range = sheet.getRange(1, PACKAGE_MAPPINGS_FORM_COLUMN, 1, 1);
        range.setValue('Form option name');
        range.setFontWeight('bold');
    }
    {
        const range = sheet.getRange(1, PACKAGE_MAPPINGS_API_COLUMN, 1, 1);
        range.setValue('Fabman package');
        range.setFontWeight('bold');
    }

    sheet.autoResizeColumn(1);
    sheet.autoResizeColumn(2);
}


function update_field_mappings_sheet() {
    const form_sheet = get_form_data_sheet();
    const mappings_sheet = get_sheet(FIELD_MAPPINGS_SHEET_NAME);

    const first_mappings_row = 2;
    const [form_header] = form_sheet.getRange(1, 1, 1, form_sheet.getLastColumn()).getValues();
    if (!form_header[form_header.length - 1]) { // Remove potential "result" column (without title) at the end
        form_header.pop();
    }
    const field_names = form_header;
    const changed = insert_or_delete_rows(mappings_sheet, first_mappings_row, form_header, 'form field', 'ignore');

    if (changed) {
        mappings_sheet.autoResizeColumn(1);

        // Prevent the name column from being edited
        const protections = mappings_sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
        protections.forEach(p => p.remove());

        const description = `Please use the menu item "Extensions -> Fabman Self-Sign-Up -> ${MENU_ITEM_UPDATE_FROM_FORM_TITLE}" if any form fields were added, removed, or renamed.`;

        const mapping_name_range = mappings_sheet.getRange(first_mappings_row, 1, mappings_sheet.getLastRow() - first_mappings_row + 1, 1);
        mapping_name_range.setNote(description);

        const protection = mapping_name_range.protect();
        protection.setDescription(description);
        protection.setWarningOnly(true);

        // Set up the auto-fill settings for the mapping column
        const validation_rule = SpreadsheetApp.newDataValidation()
            .requireValueInList(Object.keys(API_FIELDS), true)
            .setHelpText('Please select one of the Fabman member fields')
            .setAllowInvalid(false)
            .build();
        const mapping_value_range = mappings_sheet.getRange(first_mappings_row, 2, mappings_sheet.getLastRow() - first_mappings_row + 1, 1);
        mapping_value_range.setDataValidation(validation_rule);
    }
}

function insert_or_delete_rows(sheet, first_row, names, name_description, default_value) {
    let existing = [];
    if (sheet.getLastRow() >= first_row) {
        const mapping_name_range = sheet.getRange(first_row, 1, sheet.getLastRow() - first_row + 1, 1);
        existing = mapping_name_range.getValues();
    }

    // Delete names that don’t exist (anymore)
    for (let index = existing.length - 1; index >= 0; index -= 1) {
        const row = existing[index];
        let found = false;
        for (const name of names) {
            if (row[0] == name) {
                found = true;
                break;
            }
        }

        if (!found) {
            const row_number = first_row + index;
            Logger.log(`Deleting row ${row_number} because ${name_description} "${row[0]}" no longer exists.`);
            sheet.deleteRow(row_number);
        }
    }

    let changed = false;
    // Insert missing names
    for (const name of names) {
        let found = false;
        for (const row of existing) {
            if (row[0] == name) {
                found = true;
                break;
            }
        }

        if (!found) {
            Logger.log(`Could not find row for ${name_description} "${name}". Inserting row after ${sheet.getLastRow()}…`);
            sheet.insertRowAfter(sheet.getLastRow());
            const new_row_index = sheet.getLastRow() + 1;
            const newNameRange = sheet.getRange(new_row_index, 1);
            newNameRange.setValue(name);
            newNameRange.setFontWeight('normal');
            const newValueRange = sheet.getRange(new_row_index, 2);
            newValueRange.setValue(default_value);
            newValueRange.setFontWeight('normal');
            changed = true;
        }
    }
    return changed;
}


function add_mapping_error(row, message) {
    // @ToDo: Show the error on the mapped field instead
    throw new Error(message);
}

function update_package_mappings_sheet(ask_for_key) {
    Logger.log('Updating package mappings sheet');
    const api_key = ask_for_key ? get_or_ask_for_api_key() : get_api_key(); // Do this at the beginning so we don’t ask after running for many seconds

    const mappings_sheet = get_sheet(PACKAGE_MAPPINGS_SHEET_NAME);
    const first_mappings_row = 2;

    let package_mapping_row;
    let package_form_item_title;
    const field_map = get_field_map();
    for (const [name, value] of field_map) {
        if (value.details && value.details.package) {
            package_form_item_title = name;
            package_mapping_row = value.row;
            break;
        }
    }
    if (!package_form_item_title) {
        insert_or_delete_rows(mappings_sheet, first_mappings_row, [`Please go to "${FIELD_MAPPINGS_SHEET_NAME}" and map one of your form fields to the Fabman field "Package name" before configuring the package mappings.`], 'form package option', '');
        mappings_sheet.autoResizeColumn(1);
        return;
    }

    let form_choices;
    const form = get_form();
    const form_items = form.getItems();
    for (const item of form_items) {
        // Logger.log(`Form item ${item.getId()}: ${item.getTitle()} ${item.getType()}`);
        if (item.getTitle() == package_form_item_title) {
            if (item.getType() == FormApp.ItemType.LIST) {
                const list_item = item.asListItem();
                form_choices = list_item.getChoices().map(c => c.getValue());
            } else if (item.getType() == FormApp.ItemType.MULTIPLE_CHOICE) {
                const mc_item = item.asMultipleChoiceItem();
                form_choices = mc_item.getChoices().map(c => c.getValue());
            } else {
                add_mapping_error(package_mapping_row, 'This form field must be a list or multiple-choice item to be mapped to the package name.');
                return;
            }
        }
    }

    const changed = insert_or_delete_rows(mappings_sheet, first_mappings_row, form_choices, 'form package option', '');
    if (changed) {
        mappings_sheet.autoResizeColumn(1);

        // Prevent the name column from being edited
        const protections = mappings_sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
        protections.forEach(p => p.remove());

        const description = `Please use the menu item "Extensions -> Fabman Self-Sign-Up -> ${MENU_ITEM_UPDATE_FROM_FORM_TITLE}" if you changed any package options in Google Forms.`;

        const mapping_name_range = mappings_sheet.getRange(first_mappings_row, 1, mappings_sheet.getLastRow() - first_mappings_row + 1, 1);
        mapping_name_range.setNote(description);

        const protection = mapping_name_range.protect();
        protection.setDescription(description);
        protection.setWarningOnly(true);
    }

    // Set up the auto-fill settings for the mapping column
    let validation_rule;
    if (api_key) {
        const packages = fetch_packages(api_key);
        const package_names = packages.map(p => `${p.name} (ID: ${p.id})`);
        validation_rule = SpreadsheetApp.newDataValidation()
            .requireValueInList(package_names, true)
            .setHelpText('Please select one of your Fabman packages')
            .setAllowInvalid(false)
            .build();
    } else {
        const message = 'Please enter a valid API key on the "Settings" sheet first!';
        validation_rule = SpreadsheetApp.newDataValidation()
            .requireValueInList([message], true)
            .setHelpText(message)
            .setAllowInvalid(false)
            .build();
    }
    const mapping_value_range = mappings_sheet.getRange(first_mappings_row, 2, mappings_sheet.getLastRow() - first_mappings_row + 1, 1);
    mapping_value_range.setDataValidation(validation_rule);
    mappings_sheet.autoResizeColumn(2);
}

function validate_settings() {
    const api_key = get_or_ask_for_api_key();
    if (api_key && !validate_api_key(get_api_key_range())) return;

    const field_map = get_field_map();

    if (!validate_field_mappings(field_map)) return;

    if (!validate_packages(field_map)) return;

    const ui = SpreadsheetApp.getUi();
    ui.alert('Everything is alright', 'Your setting seem to be OK.', ui.ButtonSet.OK);
}

function validate_field_mappings(field_map) {
    const mappings_sheet = get_sheet(FIELD_MAPPINGS_SHEET_NAME);
    const first_mappings_row = 2;
    const values_range = mappings_sheet.getRange(first_mappings_row, FIELD_MAPPINGS_API_COLUMN, mappings_sheet.getLastRow() - first_mappings_row + 1, 1);
    values_range.setBackgroundColor(null);

    // let used = {};
    let found_name = false;
    for (const [name, mapping] of field_map) {
        const details = mapping.details;
        if (!details) continue;

        // Check that no field is mapped more than once:
        // if (used[mapping.name]) {
        //     const ui = SpreadsheetApp.getUi();
        //     const message = `The Fabman member field \"${mapping.name}\" is mapped to more than one form field.`;
        //     ui.alert('Field mapped more than once', message, ui.ButtonSet.OK);
        //     const range1 = mappings_sheet.getRange(used[mapping.name], FIELD_MAPPINGS_API_COLUMN);
        //     const range2 = mappings_sheet.getRange(mapping.row, FIELD_MAPPINGS_API_COLUMN);
        //     range1.setBackgroundColor('red');
        //     range2.setBackgroundColor('red');
        //     range1.activate();
        //     return false;
        // }
        // used[mapping.name] = mapping.row;

        // Check that at least one field is mapped to a name field:
        if (details.member == 'firstName' || details.member == 'lastName') {
            found_name = true;
        }
    }
    if (!found_name) {
        const ui = SpreadsheetApp.getUi();
        const message = 'Members need to have at least a first name or a last name. You have to map one form field to Fabman member field "First name" and/or "Last name".';
        ui.alert('Name not mapped', message, ui.ButtonSet.OK);
        mappings_sheet.activate();
        return false;
    }

    return true;
}


function validate_packages(field_map) {
    let has_package_field = false;
    for (const [name, value] of field_map) {
        if (value.details && value.details.package) {
            has_package_field = true;
            break;
        }
    }
    if (!has_package_field) return true; // No need to validate anything

    const api_key = get_or_ask_for_api_key();

    const sheet = get_sheet(PACKAGE_MAPPINGS_SHEET_NAME);

    const api_packages = fetch_packages(api_key);
    const packages = get_configured_packages();
    for (const [name, pkg] of packages) {
        if (!pkg.id) {
            const ui = SpreadsheetApp.getUi();
            const message = `You have not selected a Fabman package for form option "${name}"`;
            ui.alert('Package not mapped', message, ui.ButtonSet.OK);
            sheet.getRange(pkg.row, PACKAGE_MAPPINGS_API_COLUMN).activate();
            return false;
        }
        if (!find_package(api_packages, pkg.id)) {
            const ui = SpreadsheetApp.getUi();
            const message = `Could not find the package with ID ${pkg.id} for form option "${name}" in your Fabman account.\n` +
                `Please use the menu item "Extensions -> Fabman Self-Sign-Up -> ${MENU_ITEM_UPDATE_FROM_FABMAN_TITLE}" if you have added/removed packages from Fabman.`;
            ui.alert('Package not found', message, ui.ButtonSet.OK);
            sheet.getRange(pkg.row, PACKAGE_MAPPINGS_API_COLUMN).activate();
            return false;
        }
    }

    return true;
}

function find_package(packages, package_id) {
    for(const pkg of packages) {
        if (pkg.id == package_id) return true;
    }
    return false;
}
