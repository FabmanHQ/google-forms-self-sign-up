// @ToDo: Map county code somehow?
function on_form_submitted(e) {
    Logger.log(`Event data: ${JSON.stringify(e.namedValues)}, event: ${JSON.stringify(e)}`);
    const range = e.range;
    const form_sheet = get_form_data_sheet();
    const [form_header] = form_sheet.getRange(1, range.getColumn(), 1, range.getWidth()).getValues();
    const [typed_values] = range.getValues();
    // Logger.log(`Typed values: ${JSON.stringify(form_header)}: ${JSON.stringify(typed_values)}`);

    const submitted_data = e.namedValues;
    let status_column = form_sheet.getLastColumn();
    const status_column_title = form_sheet.getRange(1, status_column, 1, 1).getValue();
    // We used to check if there is any title in that column and, if yes, pick the next column (since our status column does not contain a title).
    // But using some (unknown) Google Sheets feature automatically adds a "Column N" title to every column without a title.
    // So instead we now only move if we’re in a column that belongs to the form.
    //  -rluba, 2024-12-19
    if (status_column_title && submitted_data[status_column_title] !== undefined) {
        status_column += 1;
    }

    const statusRange = form_sheet.getRange(range.getRow(), status_column, 1, 1);
    Logger.log(`Status range: ${range.getRow()}/${range.getColumn()} -> ${statusRange.getRow()}/${statusRange.getColumn()}`);

    try {
        const package_map = get_configured_packages();
        const field_map = get_field_map();
        const gender_map = get_configured_genders();

        const api_key = get_api_key();
        const me = fetch_me(api_key);
        Logger.log(me);

        const spaces = fetch(api_key, '/spaces');

        let member_data = {
            account: me.account,
            notes: `Added via "Fabman Self Sign-Up for Google Sheets & Forms"`,
        };
        let packages = [];

        // Retrieve original order of fields in the form and sort the field names accordingly
        const field_names = Object.keys(submitted_data);
        const form_items = get_form().getItems();
        const ordered_titles = form_items.map(i => i.getTitle());
        field_names.sort((a, b) => ordered_titles.indexOf(a) - ordered_titles.indexOf(b));

        for (const field of field_names) {
            const typed_value = typed_values[form_header.indexOf(field)];
            // Logger.log(`${field}: real value: '${typed_value}' vs. submitted: '${submitted_data[field]}'`);
            set_value(field, typed_value || null, field_map, package_map, gender_map, member_data, packages);
        }

        if (!(member_data.firstName || member_data.lastName)) {
            throw new Error("A member must have at least a first name or a last name");
        }

        let member_space;
        if (member_data.space) {
            member_space = spaces.find(s => s.id == member_data.space);
        } else {
            if (spaces.length > 1) {
                throw new Error(`Account ${me.id} contains ${spaces.length} spaces, so you need to specify one.`);
            }
            member_data.space = spaces[0].id;
            member_space = spaces[0];
        }

        const member_response = try_send_request(api_key, 'POST', '/members', member_data);
        if (member_response.getResponseCode() > 299) {
            if (is_error(member_response, 422, 'duplicateEmailAddress')) {
                // @ToDo: Better email template?
                GmailApp.sendEmail(member_data.emailAddress, `Sign-up for ${member_space.name}`, `You tried signing up for ${member_space.name}, but there’s already a member with your email address.\n\n* If you already have an account and want to sign in, please go to https://fabman.io/members/${member_data.account}/login\n* If you have forgotten your password, then go to https://fabman.io/members/${member_data.account}/user/password-forgotten`);
                return;
            } else {
                handle_request_error(member_response);
                return;
            }
        }

        const member = JSON.parse(member_response.getContentText());

        for (const pkg of packages) {
            const member_package = {
                package: pkg.id,
                fromDate: pkg.fromDate || Utilities.formatDate(new Date(), member_space.timezone || "UTC", "yyyy-MM-dd"),
                notes: `Assigned during self sign-up`,
            };
            send_request(api_key, 'POST', `/members/${member.id}/packages`, member_package);
        }

        const resultValue = SpreadsheetApp.newRichTextValue()
            .setText('Added to Fabman')
            .setLinkUrl(`https://fabman.io/manage/${member.account}/members/${member.id}`)
            .build();
        statusRange.setRichTextValue(resultValue);
    } catch (e) {
        statusRange.setValue(`Error occurred while trying to create the member:\n${e.toString()}`);
        throw e;
    }
}

function set_value(form_field_name, form_value, field_map, package_map, gender_map, member_data, packages) {
    const mapping = field_map.get(form_field_name);
    if (!mapping || !mapping.details) return;

    const details = mapping.details;
    let value = form_value;
    if (details.date) {
        if (value) {
            if (!value.getUTCDate) { // Check if it’s a Date
                value = Date.parse(value); // Let’s hope it’s in a format that Date.parse can handle…
            }

            // JavaScript makes it really hard to get a YYYY-MM-DD string in the _local_ timezone.
            // I can’t believe we have to do it this way in 2023…
            //  -rluba, 2023-05-08
            const y = value.getFullYear()
            const m = ('0' + (value.getMonth() + 1)).slice(-2)
            const d = ('0' + value.getDate()).slice(-2)
            value = `${y}-${m}-${d}`;
        } else {
            value = null;
        }
    } else if (typeof(value) === "number") {
        value = '' + value; // Convert numbers to string
    }

    if (details.member) {
        if (details.member === 'gender') {
            if (value) {
                const gender = gender_map.get(value);
                if (!gender) {
                    throw new Error(`Could not find a mapping for gender name "${form_value}".`);
                }
                member_data.gender = gender.id;
            }
        } else if (member_data[details.member] && value) {
            if (details.rich_text) {
                member_data[details.member] += `<br>${form_field_name}: ${value}`;
            } else {
                member_data[details.member] += ` ${value}`;
            }
        } else {
            member_data[details.member] = value;
        }
    } else if (details.package) {
        if (value) {
            if (details.package === 'name') {
                const pkg = package_map.get(value);
                if (!pkg) {
                    throw new Error(`Could not find a mapping for package name "${form_value}".`);
                }
                packages.push({id: pkg.id});
            } else if (details.package === 'fromDate') {
                const lastPackage = packages[packages.length - 1];
                if (lastPackage && !lastPackage.fromDate) {
                    lastPackage.fromDate = value;
                } else {
                    Logger.log(`Could not find a package for the package date: ${JSON.stringify(packages)}`);
                }
            }
        }
    } else {
        throw new Error(`Unexpected field mapping configuration for form field ${form_field_name}: ${JSON.stringify(mapping)}`);
    }
}

