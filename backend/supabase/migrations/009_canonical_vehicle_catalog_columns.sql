alter table if exists public.canonical_vehicles
  add column if not exists body_type text null;

alter table if exists public.canonical_vehicles
  add column if not exists engine text null;

alter table if exists public.canonical_vehicles
  add column if not exists drivetrain text null;

alter table if exists public.canonical_vehicles
  add column if not exists transmission text null;

alter table if exists public.canonical_vehicles
  add column if not exists fuel_type text null;

alter table if exists public.canonical_vehicles
  add column if not exists horsepower integer null;

alter table if exists public.canonical_vehicles
  add column if not exists torque text null;

alter table if exists public.canonical_vehicles
  add column if not exists msrp integer null;

do $$
begin
  if to_regclass('public.canonical_vehicles') is not null then
    update public.canonical_vehicles
    set
      body_type = coalesce(body_type, specs_json ->> 'bodyStyle'),
      engine = coalesce(engine, specs_json ->> 'engine'),
      drivetrain = coalesce(drivetrain, specs_json ->> 'drivetrain'),
      transmission = coalesce(transmission, specs_json ->> 'transmission'),
      horsepower = coalesce(horsepower, nullif(specs_json ->> 'horsepower', '')::integer),
      torque = coalesce(torque, specs_json ->> 'torque'),
      msrp = coalesce(msrp, nullif(specs_json ->> 'msrp', '')::integer)
    where specs_json is not null;

    execute 'create index if not exists idx_canonical_vehicles_make_model_year on public.canonical_vehicles (normalized_make, normalized_model, year)';
  end if;
end
$$;
