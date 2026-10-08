const mongoose = require("mongoose");
const Customer = require("../models/Customer");

const applyProjectFilters = async ({
    finalQuery,
    filters
}) => {

    const {
        company_name,
        customer_name,
        project_name,
        project_number,
        project_type,
        project_creation_type,
        estimated_value,
        createdAt,
        status
    } = filters;

    // COMPANY NAME
    if (company_name?.trim()) {

        const customerIds = await Customer.find({
            company_name: {
                $regex: company_name,
                $options: "i"
            }
        }).distinct("_id");

        finalQuery.customer_ids = {
            $in: customerIds
        };
    }

    // CUSTOMER NAME
    if (customer_name?.trim()) {

        const customerIds = await Customer.find({
            contact_name: {
                $regex: customer_name,
                $options: "i"
            }
        }).distinct("_id");

        finalQuery.customer_ids = {
            $in: customerIds
        };
    }

    // PROJECT NAME
    if (project_name?.trim()) {
        finalQuery.project_name = {
            $regex: project_name,
            $options: "i"
        };
    }

    // PROJECT NUMBER
    if (project_number?.trim()) {
        finalQuery.project_number = {
            $regex: project_number,
            $options: "i"
        };
    }

    // DIVISION
    if (project_type?.trim()) {
        finalQuery.project_type = {
            $regex: project_type,
            $options: "i"
        };
    }

    // PROJECT CREATION TYPE
    if (project_creation_type?.trim()) {
        finalQuery.project_creation_type = {
            $regex: project_creation_type,
            $options: "i"
        };
    }

    if (status?.trim() && status !== "all") {
        finalQuery.status = {
            $regex: status,
            $options: "i"
        };
    }

    // ESTIMATED VALUE
    if (estimated_value?.trim()) {
        finalQuery.estimated_value = Number(
            estimated_value
        );
    }

    // CREATED DATE
    if (createdAt?.trim()) {

        const startDate = new Date(createdAt);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(createdAt);
        endDate.setHours(23, 59, 59, 999);

        finalQuery.$or = [
            {
                createdAt: {
                    $gte: startDate,
                    $lte: endDate
                }
            },
            {
                created_date: {
                    $gte: startDate,
                    $lte: endDate
                }
            }
        ];
    }

    return finalQuery;
};

module.exports = applyProjectFilters;