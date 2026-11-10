-- Sign up one user first (Supabase Auth), then run this to give them demo appointments.
insert into appointments (user_id, doctor, starts_at, status)
select id, 'Dr. Salma Nabil', now() + interval '2 days', 'confirmed' from auth.users order by created_at limit 1;

insert into appointments (user_id, doctor, starts_at, status)
select id, 'Dr. Omar Fathy', now() + interval '9 days', 'confirmed' from auth.users order by created_at limit 1;

insert into appointments (user_id, doctor, starts_at, status)
select id, 'Dr. Salma Nabil', now() - interval '20 days', 'completed' from auth.users order by created_at limit 1;
