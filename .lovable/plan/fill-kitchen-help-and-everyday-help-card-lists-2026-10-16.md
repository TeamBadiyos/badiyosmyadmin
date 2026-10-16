# Fill Kitchen Help and Everyday Help card lists

Card 1 (Daily Cleaning) already has its text. This adds the text from your file to cards 2 and 3, in English and मराठी.

## Card 2: Kitchen Help / स्वयंपाकघर मदत
- Included: the 6 lines from your file (washing utensils, kitchen slab/sink/stove, outside of fridge and appliances, washing and chopping vegetables, putting things back, kitchen waste and a dry sink).
- Not included: the 6 lines (cooking, chimney/exhaust, deep cleaning inside fridge/oven, burnt deposits, broken glass, polishing silver/brass).

## Card 3: Everyday Help / घरातील इतर कामे
- Included: the 6 lines (washing machine and drying, folding clothes, bedsheets, sofa/table/study area, mirrors and glass, wardrobes and shelves).
- Not included: the 6 lines (ironing, hand-washing blankets, stain removal, child/elderly/pet care, cleaning the washing machine, cash and valuables).

## Also
- The card titles change to exactly "Kitchen Help / स्वयंपाकघर मदत" and "Everyday Help / घरातील इतर कामे".
- Photos, on/off switches, order and card 1 stay as they are.
- Applies to the content shown on your screen: the Default and any city that already has its own saved copy (such as Latur), so every editor view shows the same text.
- I'll check that the Customer App receives all 3 cards with their lists afterwards.

## Technical details
- Data-only update of `homepage_sections` rows `section_type='clean_content'`: set `cards[1]` and `cards[2]` title/title_mr/included/not_included; leave `image_url`, `enabled` and other keys. Logged in audit_logs. Verify via anon `app_service_content('clean', city)`.
