function on_form_submitted(e) {
    Logger.log(`Event data: ${JSON.stringify(e.namedValues)}`);

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
    let package_data = {};
    for (const key of Object.keys(submitted_data)) {
        set_value(key, submitted_data[key], field_map, package_map, member_data, package_data);
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
            GmailApp.sendEmail(member_data.emailAddress, `Sign-up for ${member_space.name}`, `You tried signing up for ${member_space.name}, but there’s already a member with your email address.\n\n* If you already have an account and want to sign in, please go to https://fabman.io/members/${member_data.account}/login\n* If you have forgotten your password, then go to https://fabman.io/user/password-forgotten`);
            return;
        } else {
            return handle_request_error(member_response);
        }
    }

    const member = JSON.parse(member_response.getContentText());

    if (package_data.id) {
        const member_package = {
            package: package_data.id,
            fromDate: Utilities.formatDate(new Date(), member_space.timezone || "UTC", "yyyy-MM-dd"),
            notes: `Assigned during self sign-up`,
        };
        send_request(api_key, 'POST', `/members/${member.id}/packages`, member_package);
    }

    // @ToDo: Write "added to Fabman" + a link into the column next to the member or write "failed" + error details if it failed
}

function set_value(form_field_name, form_value, field_map, package_map, member_data, package_data) {
    const mapping = field_map.get(form_field_name);
    if (!mapping || !mapping.details) return;

    const details = mapping.details;
    if (details.member) {
        member_data[details.member] = form_value[0];
    } else if (details.package) {
        const pkg = package_map.get(form_value[0]);
        if (!pkg) {
            throw new Error(`Could not find a mapping for package name "${form_value}".`);
        }
        package_data.id = pkg.id;
    } else {
        throw new Error(`Unexpected field mapping configuration for form field ${form_field_name}: ${JSON.stringify(mapping)}`);
    }
}

