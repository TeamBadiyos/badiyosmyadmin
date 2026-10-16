# Clean Auto App content: wash cards and note text

Saves the text from your file into Clean Auto → Settings → App content, in English and मराठी. Card photos and the Bike / Car / Combo price links stay as they are.

## Cards
- **Bike Wash / बाइक वॉश:** 5 included lines, 5 not included lines.
- **Car Wash / कार वॉश:** 5 included lines, 6 not included lines.
- **Combo Wash (Car + Bike) / कॉम्बो वॉश (कार + बाइक):** 5 included lines, 5 not included lines.

## Details sheet
- List titles: "Our washer will do" / "आमचा वॉशर हे करेल" and "Not included" / "यात समाविष्ट नाही".
- Note: your full water, plug point and parking note in both languages. The water icon stays.

## Where it applies
- There is no saved Default yet for Clean Auto. Only Latur has its own saved content.
- Latur's saved content gets the new text.
- A Default is also saved with the same text, Latur's photos and Latur's other settings, so new cities start with it.

## Technical details
- Data-only update of the `homepage_sections` `wash_content` row (Latur): update `cards[0..2]` title/title_mr/included/not_included and `details` note/note_mr/included_title(_mr)/excluded_title(_mr). Keep image_url, price_option_id, enabled and other keys.
- Insert a copy of that row with `city_id = null` as the Default.
- Verify via anon `app_service_content('wash', Latur)`.
