const Supplier = require('../models/Supplier');
const csv = require('csv-parser');
const fs = require('fs');

const mongoose = require('mongoose');

const escapeRegex = (text) => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const getOwnerId = (req) => {
  if (req.user.role_type === "admin") {
    return new mongoose.Types.ObjectId(req.user._id);
  }
  return new mongoose.Types.ObjectId(req.user.created_by);
};

exports.getAllSuppliers = async (req, res) => {
  try {
    const { page,
      limit,
      search,
      sort,
      company_name,
      contact_name,
      email,
      phone,
      address } = req.query;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 0;

    // Get user's owner query for filtering
    const ownerQuery = await getOwnerId(req);

    // Build Query with user filter
    let query = { created_by: ownerQuery };

    if (search) {
      const safeSearch = escapeRegex(search);
      const searchRegex = new RegExp(safeSearch, 'i');

      const digits = search.replace(/\D/g, "");
      let phoneSearchRegex = searchRegex;
      if (digits.length > 0) {
        const phoneRegexPattern = digits.split("").map((digit) => `\\D*${digit}`).join("");
        phoneSearchRegex = new RegExp(phoneRegexPattern, "i");
      }

      query = {
        created_by: ownerQuery,
        $or: [
          { company_name: searchRegex },
          { contact_name: searchRegex },
          { email: searchRegex },
          { phone: phoneSearchRegex },
          { address: searchRegex }
        ]
      };
    }

    const addRegexFilter = (field, value) => {
      if (value && value.trim() !== "") {
        if (field === "phone") {
          const digits = value.replace(/\D/g, "");
          if (digits.length > 0) {
            const phoneRegexPattern = digits.split("").map((digit) => `\\D*${digit}`).join("");
            query[field] = {
              $regex: phoneRegexPattern,
              $options: "i"
            };
          } else {
            query[field] = {
              $regex: escapeRegex(value.trim()),
              $options: "i"
            };
          }
        } else {
          query[field] = {
            $regex: escapeRegex(value.trim()),
            $options: "i"
          };
        }
      }
    };

    addRegexFilter("company_name", company_name);
    addRegexFilter("contact_name", contact_name);
    addRegexFilter("email", email);
    addRegexFilter("phone", phone);
    addRegexFilter("address", address);

    // Build Sort
    let sortQuery = { createdAt: -1 };
    if (sort) {
      const isDesc = sort.startsWith('-');
      const field = isDesc ? sort.substring(1) : sort;
      sortQuery = { [field]: isDesc ? -1 : 1 };
    }

    if (limitNum > 0) {
      // Pagination Mode
      const skip = (pageNum - 1) * limitNum;

      const total = await Supplier.countDocuments(query);
      const suppliers = await Supplier.find(query)
        .sort(sortQuery)
        .skip(skip)
        .limit(limitNum)
        .lean();

      const data = suppliers.map(s => ({
        ...s,
        id: s._id.toString(),
        _id: s._id
      }));

      const pages = Math.ceil(total / limitNum);

      return res.json({
        data,
        total,
        page: pageNum,
        limit: limitNum,
        pages
      });

    } else {
      // Legacy Mode (Return all)
      const suppliers = await Supplier.find(query).sort(sortQuery).lean();
      const data = suppliers.map(s => ({
        ...s,
        id: s._id.toString(),
        _id: s._id
      }));
      res.json(data);
    }

  } catch (error) {
    console.error('getAllSuppliers error:', error);
    res.status(500).json({
      message: 'Error fetching suppliers',
      error: error.message
    });
  }
};

exports.getSupplierById = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });

    res.json(supplier);

  } catch (error) {
    res.status(500).json({
      message: 'Error fetching supplier',
      error: error.message
    });
  }
};

exports.createSupplier = async (req, res) => {
  try {
    const { company_name, contact_name, email, phone, address } = req.body;

    const createdBy = getOwnerId(req);
    if (email) {
      const existingEmail = await Supplier.findOne({
        email: email.trim().toLowerCase(),
        created_by: createdBy
      });

      if (existingEmail) {
        return res.status(400).json({
          message: "Email already exists"
        });
      }
    }

    // ✅ PHONE DUPLICATE CHECK
    if (phone) {
      const existingPhone = await Supplier.findOne({
        phone: phone.trim(),
        created_by: createdBy
      });

      if (existingPhone) {
        return res.status(400).json({
          message: "Phone number already exists"
        });
      }
    }

    const supplier = new Supplier({
      company_name: company_name?.trim() || null,
      contact_name: contact_name?.trim() || null,
      email: email?.trim()?.toLowerCase() || null,
      phone: phone?.trim() || null,
      address: address?.trim() || null,
      created_by: createdBy
    });

    const saved = await supplier.save();
    res.status(201).json(saved);

  } catch (error) {
    res.status(500).json({ message: 'Error creating supplier', error: error.message });
  }
};


exports.updateSupplier = async (req, res) => {
  try {
    const { company_name, contact_name, email, phone, address } = req.body;

    const supplier = await Supplier.findById(req.params.id);
    if (!supplier) return res.status(404).json({ message: 'Supplier not found' });
    const createdBy = supplier.created_by;
    if (email) {
      const existingEmail = await Supplier.findOne({
        email: email.trim().toLowerCase(),
        created_by: createdBy,
        _id: { $ne: supplier._id }
      });

      if (existingEmail) {
        return res.status(400).json({
          message: "Email already exists"
        });
      }
    }

    // ✅ PHONE CHECK
    if (phone) {
      const existingPhone = await Supplier.findOne({
        phone: phone.trim(),
        created_by: createdBy,
        _id: { $ne: supplier._id }
      });

      if (existingPhone) {
        return res.status(400).json({
          message: "Phone number already exists"
        });
      }
    }

    // ALL FIELDS OPTIONAL
    supplier.company_name = company_name?.trim() || supplier.company_name;
    supplier.contact_name = contact_name?.trim() || supplier.contact_name;
    supplier.email = email?.trim()?.toLowerCase() || supplier.email;
    supplier.phone = phone?.trim() || supplier.phone;
    supplier.address = address?.trim() || supplier.address;
    supplier.updated_date = Date.now();

    const updated = await supplier.save();
    res.json(updated);

  } catch (error) {
    res.status(500).json({
      message: 'Error updating supplier',
      error: error.message
    });
  }
};

exports.bulkDeleteSuppliers = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "No suppliers selected" });
    }

    const ownerId = getOwnerId(req);

    const result = await Supplier.deleteMany({
      _id: { $in: ids },
      created_by: { $in: [ownerId, ownerId.toString()] }
    });

    res.json({
      success: true,
      deleted_count: result.deletedCount
    });

  } catch (error) {
    console.error("Bulk delete suppliers error:", error);
    res.status(500).json({
      message: "Bulk delete failed",
      error: error.message
    });
  }
};

exports.deleteSupplier = async (req, res) => {
  try {
    const supplier = await Supplier.findById(req.params.id);

    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    await supplier.deleteOne();
    res.json({ message: 'Supplier deleted successfully' });

  } catch (error) {
    res.status(500).json({
      message: 'Error deleting supplier',
      error: error.message
    });
  }
};

exports.bulkUploadSuppliers = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const results = [];
    const errors = [];
    let lineNumber = 1;

    const rootAdminId = getOwnerId(req);

    const readStream = fs.createReadStream(req.file.path).pipe(csv());

    for await (const row of readStream) {
      lineNumber++;

      try {
        const company_name = (row['Company Name'] || row.company_name)?.trim();
        const contact_name = (row['Contact Name'] || row.contact_name)?.trim();
        const email = (row['Email'] || row.email)?.trim()?.toLowerCase();
        const phone = (row['Phone'] || row.phone)?.trim();
        const address = (row['Address'] || row.address)?.trim();

        if (!company_name && !contact_name) {
          errors.push({ line: lineNumber, error: "Missing both Company Name and Contact Name" });
          continue;
        }

        // Duplicate Check
        if (email || phone) {
          const query = { created_by: rootAdminId, $or: [] };
          if (email) query.$or.push({ email });
          if (phone) query.$or.push({ phone });

          const existing = await Supplier.findOne(query);
          if (existing) {
            const field = existing.email === email ? "Email" : "Phone";
            errors.push({ line: lineNumber, error: `Supplier with this ${field} already exists` });
            continue;
          }
        }

        const supplier = new Supplier({
          company_name: company_name || null,
          contact_name: contact_name || null,
          email: email || null,
          phone: phone || null,
          address: address || null,
          created_by: rootAdminId
        });

        await supplier.save();
        results.push(supplier);

      } catch (err) {
        errors.push({ line: lineNumber, error: err.message });
      }
    }

    fs.unlinkSync(req.file.path);

    res.json({
      message: 'Bulk upload completed',
      count: results.length,
      suppliers: results,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    res.status(500).json({
      message: 'Error processing bulk upload',
      error: error.message
    });
  }
};

