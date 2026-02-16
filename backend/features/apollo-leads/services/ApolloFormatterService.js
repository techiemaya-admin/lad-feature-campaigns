/**
 * Apollo Formatter Service
 * LAD Architecture Compliant - Data formatting utilities
 * 
 * Handles formatting of Apollo API responses to consistent internal format.
 */

class ApolloFormatterService {
  /**
   * Format array of companies
   * @param {Array} companies - Array of company objects from Apollo
   * @returns {Array} Formatted companies
   */
  formatCompanies(companies) {
    return companies.map(company => this.formatCompany(company));
  }

  /**
   * Format single company object
   * @param {Object} company - Company object from Apollo
   * @returns {Object} Formatted company
   */
  formatCompany(company) {
    return {
      id: company.id,
      name: company.name,
      website: company.website_url,
      domain: company.primary_domain,
      industry: company.primary_vertical,
      location: {
        country: company.organization_raw_address_country,
        city: company.organization_raw_address_city,
        state: company.organization_raw_address_state
      },
      size: company.num_current_employees,
      revenue: company.estimated_num_employees,
      description: company.short_description,
      technologies: company.technology_names || [],
      apollo_id: company.id,
      linkedin_url: company.linkedin_url,
      twitter_url: company.twitter_url,
      facebook_url: company.facebook_url,
      created_at: new Date().toISOString()
    };
  }

  /**
   * Format array of leads/people
   * @param {Array} people - Array of person objects from Apollo
   * @returns {Array} Formatted leads
   */
  formatLeads(people) {
    return people.map(person => this.formatLead(person));
  }

  /**
   * Format single lead/person object
   * @param {Object} person - Person object from Apollo
   * @returns {Object} Formatted lead
   */
  formatLead(person) {
    return {
      id: person.id,
      name: person.name,
      first_name: person.first_name,
      last_name: person.last_name,
      title: person.title,
      email: person.email,
      phone: person.phone_numbers?.[0]?.raw_number,
      linkedin_url: person.linkedin_url,
      company_id: person.organization?.id,
      company_name: person.organization?.name,
      location: {
        country: person.country,
        city: person.city,
        state: person.state
      },
      apollo_id: person.id,
      created_at: new Date().toISOString()
    };
  }
}

module.exports = new ApolloFormatterService();

