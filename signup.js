function on_form_submitted(e) {
    Logger.log(`Event data: ${JSON.stringify(e.namedValues)}, event: ${JSON.stringify(e)}`);
    const range = e.range;
    const statusRange = range.offset(0, range.getWidth(), 1, 1);
    try {
        const submitted_data = e.namedValues;

        const package_map = get_configured_packages();
        const field_map = get_field_map();

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
            set_value(field, submitted_data[field], field_map, package_map, member_data, packages);
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

function set_value(form_field_name, form_value, field_map, package_map, member_data, packages) {
    const mapping = field_map.get(form_field_name);
    if (!mapping || !mapping.details) return;

    const details = mapping.details;
    let value = form_value[0];
    if (details.date) {
        const date_value = Utilities.parseDate(value, 'UTC', 'MM/dd/yy');
        value = Utilities.formatDate(date_value, "UTC", "yyyy-MM-dd");
    }
    if (details.member) {
        if (member_data[details.member] && value) {
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

