/**
 * Apollo Leads Data Transfer Objects
 * LAD Architecture: Field mapping and data transformation objects
 * 
 * Handles field mapping between different data formats.
 */

/**
 * Company DTO for API responses
 */
class CompanyDTO {
  constructor(companyData) {
    this.id = companyData.apollo_id || companyData.id;
    this.name = companyData.name;
    this.domain = companyData.domain;
    this.industry = companyData.industry;
    this.employee_count = companyData.employee_count || companyData.employeeCount;
    this.revenue = companyData.revenue;
    this.location = companyData.location;
    this.phone = companyData.phone;
    this.website = companyData.website;
    this.created_at = companyData.created_at;
    this.updated_at = companyData.updated_at;
  }
}

/**
 * Employee DTO for API responses
 */
class EmployeeDTO {
  constructor(employeeData) {
    this.id = employeeData.apollo_person_id || employeeData.id;
    this.name = employeeData.employee_name || employeeData.name;
    this.title = employeeData.employee_title || employeeData.title;
    this.email = employeeData.employee_email || employeeData.email;
    this.phone = employeeData.employee_phone || employeeData.phone;
    this.linkedin_url = employeeData.employee_linkedin_url || employeeData.linkedin_url;
    this.photo_url = employeeData.employee_photo_url || employeeData.photo_url;
    this.headline = employeeData.employee_headline || employeeData.headline;
    this.city = employeeData.employee_city || employeeData.city;
    this.state = employeeData.employee_state || employeeData.state;
    this.country = employeeData.employee_country || employeeData.country;
    this.company_id = employeeData.company_id;
    this.company_name = employeeData.company_name;
    this.company_domain = employeeData.company_domain;
  }
}

/**
 * Search History DTO for API responses
 */
class SearchHistoryDTO {
  constructor(historyData) {
    this.id = historyData.id;
    this.search_params = typeof historyData.search_params === 'string' 
      ? JSON.parse(historyData.search_params) 
      : historyData.search_params;
    this.results_count = historyData.results_count;
    this.created_at = historyData.created_at;
    this.user_id = historyData.user_id;
  }
}

module.exports = {
  CompanyDTO,
  EmployeeDTO,
  SearchHistoryDTO
};