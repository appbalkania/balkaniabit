-- PalletPoint Storage · 0010 · rebrand from BIT Storage
-- New trading name and domain; the legal entity is BIT LTD (same VAT number). No group tagline.

alter table public.company_settings alter column company_name set default 'PalletPoint Storage';
alter table public.company_settings alter column tagline set default null;

update public.company_settings
   set company_name = 'PalletPoint Storage',
       tagline = null,
       legal_name = 'BIT LTD',
       email = 'office@palletpoint.ie'
 where id;
