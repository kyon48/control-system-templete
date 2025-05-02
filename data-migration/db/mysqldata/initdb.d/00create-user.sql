CREATE USER 'callcenter'@'%' IDENTIFIED BY "callcenter2025";

GRANT ALL PRIVILEGES ON *.* TO 'callcenter'@'%';

FLUSH PRIVILEGES;