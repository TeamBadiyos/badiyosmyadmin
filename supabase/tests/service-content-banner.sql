-- Read-only assertions: execute with the same role used for public app reads.
-- Each assertion fails with division by zero if the public contract regresses.
with scopes as (select id from public.cities union all select null::uuid),
content as (select public.app_service_content('wash', id) as payload from scopes)
select 1 / (bool_and(not (payload ? 'banner') and not (payload ? 'campaign')))::integer as wash_omits_banner_campaign
from content;

with scopes as (select id from public.cities union all select null::uuid),
content as (select public.app_service_content('clean', id) as payload from scopes)
select 1 / (bool_and(payload ? 'banner' and payload ? 'campaign'))::integer as clean_keeps_banner_campaign
from content;