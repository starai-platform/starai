DELETE FROM recharge_cards WHERE batch_id = 1;
DELETE FROM recharge_card_batches WHERE id = 1;
DELETE FROM wallets WHERE user_id = 1;
DELETE FROM auth_identities WHERE user_id = 1;
DELETE FROM users WHERE id = 1;
DELETE FROM models WHERE code IN ('chat_demo_v1', 'image_fast_v1');
DELETE FROM system_configs;
DELETE FROM admin_users WHERE email = 'admin@starai.local';
DELETE FROM admin_roles WHERE name = 'super_admin';
