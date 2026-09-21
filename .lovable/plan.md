# Fix: "permission denied for function staff_set_service_status"

## Asli wajah (verified)

Live database me service status/hours wale saare staff functions par **`authenticated` role ko EXECUTE permission nahi hai** — sirf `postgres` aur `service_role` ke paas hai. Isliye padhna to chal raha hai (list dikh rahi hai), par koi bhi save/change karte hi "permission denied" aata hai.

Jin functions par permission missing hai (query se confirm):

- `staff_set_service_status`
- `staff_set_service_focus`
- `staff_undo_service_focus`
- `staff_set_service_hours`
- `staff_set_service_hours_enabled`
- `staff_set_service_holiday`
- `staff_remove_service_holiday`
- `staff_close_service_today`
- `staff_reopen_service_today`

Comparison ke liye: `staff_courier_set_service_flag` aur `service_effective_state` par `authenticated` ko permission hai — isiliye purana Service Toggle switch aur Preview kaam karte hain, naye buttons nahi.

## Fix

Ek chhoti migration jo sirf permissions deti hai — koi table, column ya logic change nahi:

- Upar listed 9 functions par `GRANT EXECUTE ... TO authenticated`.
- `service_next_open` (helper) par bhi `authenticated` ko EXECUTE, taaki preview me "agla open time" fail na ho.

Suraksha waisi ki waisi rahegi: ye sab `SECURITY DEFINER` functions hain aur andar khud super_admin check karte hain, isliye ops_manager ya koi aur user call karega to bhi function khud mana kar dega. UI me bhi ops_manager ke controls disabled hi rahenge.

## Verify

1. Migration ke baad Courier → Service Toggle me ek service ka status badal kar Save — error nahi aana chahiye.
2. Service Hours me ek din ka time save + holiday add/remove test.
3. "Customer ko kya dikhega" preview me agla open time dikhe.
4. Preset button ko live nahi dabayenge — sirf preview se dry-run.

Koi UI file nahi badlegi; sirf database permissions.
