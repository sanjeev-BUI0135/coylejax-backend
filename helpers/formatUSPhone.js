const formatUSPhone = (phone) => {
    if (!phone) return 'N/A';

    let cleaned = phone.toString().replace(/\D/g, '');

    // remove US country code if exists
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
        cleaned = cleaned.slice(1);
    }

    if (cleaned.length !== 10) return phone;

    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
};

module.exports = formatUSPhone;