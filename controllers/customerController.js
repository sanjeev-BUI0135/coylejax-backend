const Customer = require('../models/Customer');
const csv = require('csv-parser');
const fs = require('fs');
const { createIdQuery } = require('../utils/idHelper');
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

exports.bulkUploadCustomers = async (req, res) => {
  const owenerID = getOwnerId(req)
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const results = [];
    const errors = [];
    let lineNumber = 1;

    const readStream = fs.createReadStream(req.file.path).pipe(csv());

    for await (const row of readStream) {
      lineNumber++;

      try {
        const required = ['company_name', 'contact_name', 'email', 'phone'];
        const missing = required.filter(f => !row[f] || row[f].trim() === '');

        if (missing.length > 0) {
          errors.push({
            line: lineNumber,
            error: `Missing required fields: ${missing.join(', ')}`
          });
          continue;
        }

        // const existing = await Customer.findOne({
        //   email: row.email.trim().toLowerCase()
        // });

        // if (existing) {
        //   errors.push({
        //     line: lineNumber,
        //     error: `Customer with email ${row.email} already exists`
        //   });
        //   continue;
        // }

        const validTypes = ['residential', 'commercial', 'industrial'];
        const customerType = row.customer_type?.trim().toLowerCase() || 'residential';

        if (!validTypes.includes(customerType)) {
          errors.push({
            line: lineNumber,
            error: `Invalid customer_type "${row.customer_type}"`
          });
          continue;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(row.email.trim())) {
          errors.push({
            line: lineNumber,
            error: `Invalid email format: ${row.email}`
          });
          continue;
        }

        const customer = new Customer({
          company_name: row.company_name.trim(),
          contact_name: row.contact_name.trim(),
          email: row.email.trim().toLowerCase(),
          phone: row.phone.trim(),
          address: row.address?.trim() || '',
          city: row.city?.trim() || '',
          state: row.state?.trim() || '',
          zip_code: row.zip_code?.trim() || '',
          customer_type: customerType,
          billing_information: row.billing_information?.trim() || '',
          created_by: owenerID
        });

        await customer.save();
        results.push(customer);

      } catch (err) {
        errors.push({ line: lineNumber, error: err.message });
      }
    }

    fs.unlinkSync(req.file.path);

    res.json({
      message: "Bulk upload completed",
      count: results.length,
      customers: results,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ message: "Error processing bulk upload", error: error.message });
  }
};

exports.getCustomers = async (req, res) => {
  try {
    // Prevent browser/proxy caching so search always returns fresh results
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    const {
      page,
      limit,
      search,
      sort,
      company_name,
      contact_name,
      customer_type,
      email,
      phone,
      address } = req.query;

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 0;

    // Build Query with Owner Filter
    const ownerQuery = await getOwnerId(req);
    let query = {
      created_by: { $in: [ownerQuery, ownerQuery.toString()] }
    };

    if (search) {
      const trimmedSearch = search.trim();
      const safeSearch = escapeRegex(trimmedSearch);
      const searchRegex = new RegExp(safeSearch, "i");
      
      const digits = trimmedSearch.replace(/\D/g, "");
      const isNumericSearch = digits.length > 0 && digits.length === trimmedSearch.length;

      let phoneSearchRegex = searchRegex;
      if (isNumericSearch) {
        const phoneRegexPattern = digits.split("").map((digit) => `\\D*${digit}`).join("");
        phoneSearchRegex = new RegExp(phoneRegexPattern, "i");
      }

      query.$or = [
        { company_name: searchRegex },
        { contact_name: searchRegex },
        { email: searchRegex },
        { phone: phoneSearchRegex },
        { address: searchRegex },
        { city: searchRegex },
        { state: searchRegex },
        { customer_type: searchRegex }
      ];
    }

    const addRegexFilter = (field, value) => {
      if (value && value.trim() !== "") {
        if (field === "phone") {
          const trimmedVal = value.trim();
          const digits = trimmedVal.replace(/\D/g, "");
          // Use digit-sequence pattern ONLY when the filter value is purely numeric
          const isNumeric = digits.length > 0 && digits.length === trimmedVal.length;
          if (isNumeric) {
            const phoneRegexPattern = digits.split("").map((digit) => `\\D*${digit}`).join("");
            query[field] = {
              $regex: phoneRegexPattern,
              $options: "i"
            };
          } else {
            query[field] = {
              $regex: escapeRegex(trimmedVal),
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
    addRegexFilter("customer_type", customer_type);
    addRegexFilter("email", email);
    addRegexFilter("phone", phone);
    addRegexFilter("address", address);

    let sortQuery = { createdAt: -1 };
    if (sort) {
      const isDesc = sort.startsWith('-');
      const field = isDesc ? sort.substring(1) : sort;
      sortQuery = { [field]: isDesc ? -1 : 1 };
    }

    // If search is active, use aggregation to add relevance score so
    // exact / starts-with matches always appear before partial matches.
    if (search && search.trim()) {
      const safeSearch = escapeRegex(search.trim());
      const exactRegex    = `^${safeSearch}$`;        // full exact match
      const startsWithRegex = `^${safeSearch}`;       // starts-with match

      const addFields = {
        $addFields: {
          _relevance: {
            $switch: {
              branches: [
                // Score 3: company_name or contact_name is an exact match (case-insensitive)
                {
                  case: {
                    $or: [
                      { $regexMatch: { input: { $ifNull: ["$company_name", ""] }, regex: exactRegex, options: "i" } },
                      { $regexMatch: { input: { $ifNull: ["$contact_name", ""] }, regex: exactRegex, options: "i" } }
                    ]
                  },
                  then: 3
                },
                // Score 2: company_name or contact_name starts with the search term
                {
                  case: {
                    $or: [
                      { $regexMatch: { input: { $ifNull: ["$company_name", ""] }, regex: startsWithRegex, options: "i" } },
                      { $regexMatch: { input: { $ifNull: ["$contact_name", ""] }, regex: startsWithRegex, options: "i" } }
                    ]
                  },
                  then: 2
                }
              ],
              default: 1  // Score 1: general partial match anywhere
            }
          }
        }
      };

      const aggregateSortQuery = search
        ? { _relevance: -1, ...sortQuery }
        : sortQuery;

      if (limitNum > 0) {
        const skip = (pageNum - 1) * limitNum;

        const totalResult = await Customer.countDocuments(query);
        const customers = await Customer.aggregate([
          { $match: query },
          addFields,
          { $sort: aggregateSortQuery },
          { $skip: skip },
          { $limit: limitNum }
        ]);

        const data = customers.map(c => ({
          ...c,
          id: c._id.toString(),
          _relevance: undefined  // strip internal field from response
        }));
        const pages = Math.ceil(totalResult / limitNum);

        return res.json({
          data,
          total: totalResult,
          page: pageNum,
          limit: limitNum,
          pages
        });
      } else {
        const customers = await Customer.aggregate([
          { $match: query },
          addFields,
          { $sort: aggregateSortQuery }
        ]);

        const response = customers.map(c => ({
          ...c,
          id: c._id.toString(),
          _relevance: undefined
        }));

        return res.json(response);
      }
    }

    // ---- No search term: plain find with sort ----
    if (limitNum > 0) {
      const skip = (pageNum - 1) * limitNum;

      const total = await Customer.countDocuments(query);
      const customers = await Customer.find(query)
        .sort(sortQuery)
        .skip(skip)
        .limit(limitNum);

      const data = customers.map(c => ({
        ...c.toObject(),
        id: c.id || c._id.toString(),
        _id: c._id
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
      const customers = await Customer.find(query).sort(sortQuery);

      const response = customers.map(c => ({
        ...c.toObject(),
        id: c.id || c._id.toString(),
        _id: c._id
      }));

      return res.json(response);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getCustomerById = async (req, res) => {
  try {
    const searchId = req.params.id;
    const query = createIdQuery(searchId);

    const customer = await Customer.findOne(query);
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    res.json({
      ...customer.toObject(),
      id: customer.id || customer._id.toString(),
      _id: customer._id
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createCustomer = async (req, res) => {
  const owenerID = getOwnerId(req);

  try {
    const { email, phone } = req.body;

    // Check if email OR phone already exists for this owner
    const existing = await Customer.findOne({
      created_by: owenerID,
      $or: [
        { email: email.trim().toLowerCase() },
        { phone: phone.trim() }
      ]
    });

    if (existing) {
      let conflictField = existing.email === email.trim().toLowerCase()
        ? "email"
        : "phone";

      return res.status(400).json({
        message: `Customer with this ${conflictField} already exists`
      });
    }

    const customer = new Customer({
      ...req.body,
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      created_by: owenerID
    });

    await customer.save();
    res.status(201).json(customer);

  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// -------------------- Update Customer --------------------
exports.updateCustomer = async (req, res) => {
  try {
    // Prevent updating created_by field
    const { created_by, ...updateData } = req.body;

    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!customer) return res.status(404).json({ error: "Customer not found" });

    res.json(customer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// -------------------- Bulk Delete Customers --------------------
exports.bulkDeleteCustomers = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "No customers selected" });
    }

    const ownerId = getOwnerId(req);

    const result = await Customer.deleteMany({
      _id: { $in: ids },
      created_by: { $in: [ownerId, ownerId.toString()] }
    });

    res.json({
      success: true,
      deleted: result.deletedCount
    });

  } catch (err) {
    console.error("Bulk delete customers error:", err);
    res.status(500).json({ error: err.message });
  }
};


// -------------------- Delete Customer --------------------
exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);

    if (!customer) return res.status(404).json({ error: "Customer not found" });

    res.json({ message: "Customer deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
